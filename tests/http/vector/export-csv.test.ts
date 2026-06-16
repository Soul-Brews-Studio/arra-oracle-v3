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
    getCollectionInfo: mock(async () => ({ count: 1, name: 'fake' })),
    getAllEmbeddings: mock(async () => ({
      ids: ['doc-2'],
      documents: ['bravo, with comma'],
      embeddings: [[0, 0, 0]],
      metadatas: [{ type: 'trace', source_file: 'traces/bravo.md', concepts: ['gamma'] }],
    })),
  };
}

test('GET /api/v1/vector/export streams CSV rows with headers', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore: () => createStore() }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetcher(new Request(
    'http://local/api/v1/vector/export?collection=bge-m3&format=csv',
  ));
  const csv = await res.text();

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/csv');
  expect(csv.split('\n')[0]).toBe('id,document,type,source_file,concepts');
  expect(csv).toContain('"doc-2","bravo, with comma","trace","traces/bravo.md","[""gamma""]"');
});
