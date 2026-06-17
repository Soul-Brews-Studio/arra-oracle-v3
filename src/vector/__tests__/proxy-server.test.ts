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
});
