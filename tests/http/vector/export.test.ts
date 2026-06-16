import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

const docs = [
  {
    id: 'doc-1',
    document: 'alpha document',
    metadata: { type: 'learning', source_file: 'notes/alpha.md', concepts: '["alpha","beta"]' },
  },
  {
    id: 'doc-2',
    document: 'bravo, with comma',
    metadata: { type: 'trace', source_file: 'traces/bravo.md', concepts: ['gamma'] },
  },
];

function createStore(): VectorStoreAdapter {
  return {
    name: 'fake-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
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
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({
    getStore: (collection) => {
      collections.push(collection ?? '');
      return store;
    },
  }));

  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/v1/vector/export returns JSON rows for the selected collection', async () => {
  const store = createStore();
  const collections: string[] = [];
  const fetcher = createFetch(store, collections);

  const res = await fetcher(new Request(
    'http://local/api/v1/vector/export?collection=bge-m3&format=json',
  ));
  const body = await res.json() as Array<Record<string, unknown>>;

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(collections).toEqual(['bge-m3']);
  expect(body).toEqual([
    {
      id: 'doc-1',
      document: 'alpha document',
      type: 'learning',
      source_file: 'notes/alpha.md',
      concepts: ['alpha', 'beta'],
    },
    {
      id: 'doc-2',
      document: 'bravo, with comma',
      type: 'trace',
      source_file: 'traces/bravo.md',
      concepts: ['gamma'],
    },
  ]);
  expect(store.getAllEmbeddings).toHaveBeenCalledWith(2);
});
