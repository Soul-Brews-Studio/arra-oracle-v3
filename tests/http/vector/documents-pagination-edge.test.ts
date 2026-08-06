import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorDocumentsEndpoint } from '../../../src/routes/vector/documents.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

type Doc = { id: string; document: string; metadata: Record<string, unknown> };

function createStore(rows: Doc[]): VectorStoreAdapter {
  return {
    name: 'fake-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async (_q, limit = 10) => ({
      ids: rows.slice(0, limit).map((doc) => doc.id),
      documents: rows.slice(0, limit).map((doc) => doc.document),
      distances: rows.slice(0, limit).map(() => 0),
      metadatas: rows.slice(0, limit).map((doc) => doc.metadata),
    })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count: rows.length })),
    getCollectionInfo: mock(async () => ({ count: rows.length, name: 'fake' })),
    getAllEmbeddings: mock(async (limit = 5000) => ({
      ids: rows.slice(0, limit).map((doc) => doc.id),
      documents: rows.slice(0, limit).map((doc) => doc.document),
      embeddings: rows.slice(0, limit).map(() => [0, 0, 0]),
      metadatas: rows.slice(0, limit).map((doc) => doc.metadata),
    })),
  };
}

function createFetch(store: VectorStoreAdapter, collections: string[] = ['bge-m3']) {
  const seen: string[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createVectorDocumentsEndpoint({
    getModels: () => Object.fromEntries(collections.map((key) => [key, {}])),
    getStore: (collection) => { seen.push(collection ?? ''); return store; },
  }));
  return { seen, fetcher: createApiVersionedFetch((request) => app.handle(request)) };
}

test('GET /api/v1/vector/documents rejects unknown collections before store fallback', async () => {
  const { seen, fetcher } = createFetch(createStore([]));
  const res = await fetcher(new Request('http://local/api/v1/vector/documents?collection=missing'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(404);
  expect(body).toMatchObject({ error: 'Unknown vector collection: missing', items: [], total: 0 });
  expect(seen).toEqual([]);
});

test('GET /api/v1/vector/documents caps huge limits and normalizes bad pagination', async () => {
  const store = createStore([
    { id: 'doc-1', document: 'alpha', metadata: {} },
    { id: 'doc-2', document: 'bravo', metadata: {} },
  ]);
  const { fetcher } = createFetch(store);
  const res = await fetcher(new Request(
    'http://local/api/v1/vector/documents?limit=999999&page=-2&offset=-10',
  ));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ total: 2, page: 1, limit: 500, offset: 0 });
  expect((body.items as Array<{ id: string }>).map((item) => item.id)).toEqual(['doc-1', 'doc-2']);
  expect(store.getAllEmbeddings).toHaveBeenCalledWith(500);
});

test('GET /api/v1/vector/documents returns stable empty pagination shape', async () => {
  const { fetcher } = createFetch(createStore([]));
  const res = await fetcher(new Request('http://local/api/v1/vector/documents?page=3&limit=10'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body).toEqual({ items: [], total: 0, page: 3, limit: 10, offset: 20 });
});
