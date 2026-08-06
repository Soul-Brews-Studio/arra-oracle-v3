import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

const metadata = [
  { type: 'learning', source_file: 'notes/alpha.md', concepts: ['alpha', 'beta'] },
  { type: 'trace', sourceFile: 'traces/bravo.md', source: 'fallback', concepts: 'gamma' },
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
    getStats: mock(async () => ({ count: 2 })),
    getCollectionInfo: mock(async () => ({ count: 2, name: 'fake' })),
    getAllEmbeddings: mock(async () => ({
      ids: ['doc-1', 'doc-2'],
      documents: ['alpha document', 'bravo document'],
      embeddings: [[0, 0, 0], [1, 1, 1]],
      metadatas: metadata,
    })),
  };
}

test('GET /api/v1/vector/export streams v2-compatible vault JSON', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore: () => createStore() }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetcher(new Request(
    'http://local/api/v1/vector/export?collection=bge-m3&format=v2',
  ));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(body).toEqual({
    version: 1,
    documents: [
      { id: 'doc-1', content: 'alpha document', metadata: metadata[0], source: 'notes/alpha.md' },
      { id: 'doc-2', content: 'bravo document', metadata: metadata[1], source: 'traces/bravo.md' },
    ],
  });
});
