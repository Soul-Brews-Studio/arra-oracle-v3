import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

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
    getStats: mock(async () => ({ count: 1 })),
    getCollectionInfo: mock(async () => ({ count: 1, name: 'oracle_knowledge' })),
    getAllEmbeddings: mock(async () => ({
      ids: ['doc-1'],
      documents: ['alpha'],
      embeddings: [[0]],
      metadatas: [{ type: 'learning' }],
    })),
  };
}

test('GET /api/v1/vector/export accepts collection names from model registry deps', async () => {
  const store = createStore();
  const selected: string[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({
    getModels: () => ({
      nomic: { collection: 'oracle_knowledge' },
      'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
    }),
    getStore: (collection) => {
      selected.push(collection ?? '');
      return store;
    },
  }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetcher(new Request(
    'http://local/api/v1/vector/export?collection=oracle_knowledge&format=json',
  ));
  const body = await res.json() as Array<Record<string, unknown>>;

  expect(res.status).toBe(200);
  expect(selected).toEqual(['nomic']);
  expect(body).toEqual([{
    id: 'doc-1',
    document: 'alpha',
    type: 'learning',
    source_file: '',
    concepts: [],
  }]);
});
