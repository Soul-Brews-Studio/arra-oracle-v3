import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorDocumentsEndpoint } from '../../../src/routes/vector/documents.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

const docs = [
  { id: 'doc-1', document: 'alpha', metadata: { type: 'note' } },
  { id: 'doc-2', document: 'bravo', metadata: { type: 'note' } },
  { id: 'doc-3', document: 'charlie', metadata: { type: 'trace' } },
  { id: 'doc-4', document: 'delta', metadata: { type: 'trace' } },
  { id: 'doc-5', document: 'echo', metadata: { type: 'vault' } },
];

function createStore(): VectorStoreAdapter {
  return {
    name: 'fake-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({
      ids: docs.map((doc) => doc.id),
      documents: docs.map((doc) => doc.document),
      distances: docs.map(() => 0),
      metadatas: docs.map((doc) => doc.metadata),
    })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count: docs.length })),
    getCollectionInfo: mock(async () => ({ count: docs.length, name: 'fake' })),
    getAllEmbeddings: mock(async (limit = 5000) => {
      const limited = docs.slice(0, limit);
      return {
        ids: limited.map((doc) => doc.id),
        documents: limited.map((doc) => doc.document),
        embeddings: limited.map(() => [0, 0, 0]),
        metadatas: limited.map((doc) => doc.metadata),
      };
    }),
  };
}

function createFetch(store: VectorStoreAdapter, collections: string[]) {
  const app = new Elysia({ prefix: '/api' }).use(createVectorDocumentsEndpoint({
    getStore: (collection) => {
      collections.push(collection ?? '');
      return store;
    },
  }));

  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/v1/vector/documents returns offset-paged vector documents', async () => {
  const store = createStore();
  const collections: string[] = [];
  const fetcher = createFetch(store, collections);

  const res = await fetcher(new Request(
    'http://local/api/v1/vector/documents?collection=bge-m3&limit=2&offset=2',
  ));
  const body = await res.json() as {
    items: Array<{ id: string; document: string; metadata: Record<string, unknown> }>;
    total: number;
    page: number;
    limit: number;
    offset: number;
  };

  expect(res.status).toBe(200);
  expect(collections).toEqual(['bge-m3']);
  expect(body).toEqual({
    items: [
      { id: 'doc-3', document: 'charlie', metadata: { type: 'trace' } },
      { id: 'doc-4', document: 'delta', metadata: { type: 'trace' } },
    ],
    total: 5,
    page: 2,
    limit: 2,
    offset: 2,
  });
  expect(store.getAllEmbeddings).toHaveBeenCalledWith(4);
});
