/**
 * ORACLE_VECTOR_READONLY=1 (src/vector-server.ts) previously only relabeled
 * the startup log line — POST /vectors/add and DELETE /vectors/collection
 * stayed reachable and mutating regardless of the flag. A query-only sidecar
 * deployment needs the flag actually enforced at the route layer.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createVectorProxyServer } from '../proxy-server.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../adapter.ts';

class FakeStore implements VectorStoreAdapter {
  readonly name = 'fake-lancedb';
  connected = 0;
  deleted = 0;
  docs: VectorDocument[] = [];

  async connect() { this.connected++; }
  async close() {}
  async ensureCollection() {}
  async deleteCollection() { this.deleted++; this.docs = []; }
  async addDocuments(docs: VectorDocument[]) { this.docs.push(...docs); }
  async query(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async queryById(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async getStats() { return { count: this.docs.length }; }
  async getCollectionInfo() { return { count: this.docs.length, name: 'oracle_test' }; }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://vector.local${path}`, init);
}

const addRequest = () => request('/vectors/add', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ documents: [{ id: 'a', document: 'alpha', metadata: {} }] }),
});

const savedFlag = process.env.ORACLE_VECTOR_READONLY;
afterEach(() => {
  if (savedFlag === undefined) delete process.env.ORACLE_VECTOR_READONLY;
  else process.env.ORACLE_VECTOR_READONLY = savedFlag;
});

describe('vector proxy server — ORACLE_VECTOR_READONLY enforcement', () => {
  test('POST /vectors/add is rejected with 403 and never reaches the store', async () => {
    process.env.ORACLE_VECTOR_READONLY = '1';
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });

    const response = await app.handle(addRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('read-only') });
    expect(store.docs.length).toBe(0);
    expect(store.connected).toBe(0);
  });

  test('DELETE /vectors/collection is rejected with 403 and never reaches the store', async () => {
    process.env.ORACLE_VECTOR_READONLY = '1';
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });

    const response = await app.handle(request('/vectors/collection', { method: 'DELETE' }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('read-only') });
    expect(store.deleted).toBe(0);
    expect(store.connected).toBe(0);
  });

  test('without the flag, add and delete still work (no regression)', async () => {
    delete process.env.ORACLE_VECTOR_READONLY;
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });

    const add = await app.handle(addRequest());
    expect(add.status).toBe(200);
    expect(store.docs.length).toBe(1);

    const del = await app.handle(request('/vectors/collection', { method: 'DELETE' }));
    expect(del.status).toBe(200);
    expect(store.deleted).toBe(1);
  });

  test('a non-"1" value (e.g. "0") does not trigger read-only rejection', async () => {
    process.env.ORACLE_VECTOR_READONLY = '0';
    const store = new FakeStore();
    const app = createVectorProxyServer({ store });

    const response = await app.handle(addRequest());

    expect(response.status).toBe(200);
    expect(store.docs.length).toBe(1);
  });
});
