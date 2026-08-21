import { describe, expect, test } from 'bun:test';
import pkg from '../../../package.json' with { type: 'json' };
import { createVectorProxyServer } from '../proxy-server.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../adapter.ts';

class FakeStore implements VectorStoreAdapter {
  readonly name = 'fake-lancedb';
  connected = 0;
  ensured = 0;
  docs: VectorDocument[] = [];

  async connect() { this.connected++; }
  async close() {}
  async ensureCollection() { this.ensured++; }
  async deleteCollection() { this.docs = []; }
  async addDocuments(docs: VectorDocument[]) { this.docs.push(...docs); }
  async query(text: string, limit = 10, where?: Record<string, unknown>): Promise<VectorQueryResult> {
    const matches = this.docs.filter((doc) => !where || Object.entries(where).every(([key, value]) => doc.metadata[key] === value));
    return {
      ids: matches.slice(0, limit).map((doc) => doc.id),
      documents: matches.slice(0, limit).map((doc) => `${text}:${doc.document}`),
      distances: matches.slice(0, limit).map(() => 0.1),
      metadatas: matches.slice(0, limit).map((doc) => doc.metadata),
    };
  }
  async queryById(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async getStats() { return { count: this.docs.length }; }
  async getCollectionInfo() { return { count: this.docs.length, name: 'oracle_test' }; }
  async getAllEmbeddings(limit = 5000) {
    const docs = this.docs.slice(0, limit);
    return {
      ids: docs.map((doc) => doc.id),
      embeddings: docs.map((doc) => doc.vector || []),
      metadatas: docs.map((doc) => doc.metadata),
      documents: docs.map((doc) => doc.document),
    };
  }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://vector.local${path}`, init);
}

describe('standalone vector proxy server', () => {
  test('package exposes a Bun script for the LanceDB vector sidecar', () => {
    expect(pkg.scripts['vector:proxy']).toBe('ORACLE_VECTOR_DB=lancedb bun src/vector-server.ts');
  });

  test('exposes health, add, query, stats, and delete endpoints used by ProxyVectorAdapter', async () => {
    const store = new FakeStore();
    const app = createVectorProxyServer({ store, collectionName: 'oracle_test', version: '1.2.3' });

    const health = await app.handle(request('/health'));
    expect(await health.json()).toMatchObject({ status: 'ok', name: 'fake-lancedb', protocol: 'vector-proxy-v1' });

    const add = await app.handle(request('/vectors/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: [{ id: 'a', document: 'alpha', metadata: { tenant: 'one' }, vector: [0.1] }] }),
    }));
    expect(await add.json()).toEqual({ ok: true, added: 1 });
    expect(store.connected).toBe(1);
    expect(store.ensured).toBe(1);

    const query = await app.handle(request('/vectors/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'find', limit: 5, where: { tenant: 'one' } }),
    }));
    expect(await query.json()).toMatchObject({ ids: ['a'], documents: ['find:alpha'] });

    const stats = await app.handle(request('/vectors/stats'));
    expect(await stats.json()).toEqual({ count: 1, name: 'oracle_test' });

    const exported = await app.handle(request('/vectors/export?limit=1'));
    expect(await exported.json()).toEqual({
      ids: ['a'],
      embeddings: [[0.1]],
      metadatas: [{ tenant: 'one' }],
      documents: ['alpha'],
    });

    const deleted = await app.handle(request('/vectors/collection', { method: 'DELETE' }));
    expect(await deleted.json()).toEqual({ ok: true });
  });

  test('rejects invalid protocol requests before touching storage', async () => {
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });
    const response = await app.handle(request('/vectors/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: 'nope' }),
    }));

    expect(response.status).toBe(400);
    expect(store.connected).toBe(0);
  });

  test('returns explicit 501 when the backing store cannot export embeddings', async () => {
    const store = new FakeStore();
    (store as unknown as { getAllEmbeddings?: undefined }).getAllEmbeddings = undefined;
    const app = createVectorProxyServer({ store });

    const response = await app.handle(request('/vectors/export'));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'Vector export is not supported by this adapter' });
  });

  // ORA-SHARED-20260821-10: ordinary search traffic never calls /vectors/*
  // (it goes through /api/search, a separate store), so `ready` used to stay
  // false forever with no low-level route ever hit. /health now readies its
  // own store opportunistically instead of only reporting a flag nothing sets.
  test('GET /health readies the store itself instead of only reporting a flag nothing sets', async () => {
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });

    const first = await app.handle(request('/health'));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'ok', ready: true });
    expect(store.connected).toBe(1);
    expect(store.ensured).toBe(1);

    // Repeated health checks must not reconnect — readyStore()'s own guard
    // short-circuits once ready.
    const second = await app.handle(request('/health'));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: 'ok', ready: true });
    expect(store.connected).toBe(1);
    expect(store.ensured).toBe(1);
  });

  // Round 2 (Riddler P1, ORA-SHARED-20260821-10): a degraded store used to
  // still answer 200, and install-*-launchagent.sh's wait loop is
  // `curl -fsS ... >/dev/null` — status-code-only, it never inspects the
  // JSON body. A 200 "degraded" response was therefore reported by the
  // installer as a successful install of a store that cannot actually serve
  // requests.
  test('GET /health reports degraded via a non-2xx status, not a 500 and not a masked 200, when the store fails to connect', async () => {
    const store = new FakeStore();
    store.connect = async () => { throw new Error('lancedb unreachable'); };
    const app = createVectorProxyServer({ store });

    const response = await app.handle(request('/health'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'degraded', ready: false, error: 'lancedb unreachable' });
  });

  test('install-script health-wait seam: curl -fsS semantics only pass for a genuinely ready store', async () => {
    // Mirrors exactly what `curl -fsS url >/dev/null; echo $?` checks —
    // 2xx succeeds, anything else fails — since that's literally what the
    // real install-server-launchagent.sh / install-vector-launchagent.sh
    // wait loops use to decide "running" vs. retry-then-fail-loud.
    const curlFsSWouldSucceed = (status: number) => status >= 200 && status < 300;

    const healthyApp = createVectorProxyServer({ store: new FakeStore() });
    const healthyResponse = await healthyApp.handle(request('/health'));
    expect(curlFsSWouldSucceed(healthyResponse.status)).toBe(true);

    const brokenStore = new FakeStore();
    brokenStore.connect = async () => { throw new Error('lancedb unreachable'); };
    const brokenApp = createVectorProxyServer({ store: brokenStore });
    const brokenResponse = await brokenApp.handle(request('/health'));
    expect(curlFsSWouldSucceed(brokenResponse.status)).toBe(false);
  });
});
