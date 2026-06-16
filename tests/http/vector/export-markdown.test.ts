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
    getStats: mock(async () => ({ count: 3 })),
    getCollectionInfo: mock(async () => ({ count: 3, name: 'fake' })),
    getAllEmbeddings: mock(async () => ({
      ids: ['alpha-1', 'alpha-2', 'bravo-1'],
      embeddings: [[0], [1], [2]],
      metadatas: [
        { source_file: 'notes/alpha.md', content: '# Alpha' },
        { source_file: 'notes/alpha.md', content: 'Second paragraph' },
        { sourceFile: 'notes/bravo.md', text: 'Bravo body' },
      ],
    })),
  };
}

test('GET /api/v1/vector/export reconstructs Markdown from source metadata', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore: () => createStore() }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetcher(new Request('http://local/api/v1/vector/export?collection=bge-m3&format=markdown'));
  const markdown = await res.text();

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/markdown');
  expect(res.headers.get('content-disposition')).toContain('bge-m3.md');
  expect(markdown).toContain('<!-- source: notes/alpha.md -->\n\n# Alpha\n\nSecond paragraph');
  expect(markdown).toContain('---\n\n<!-- source: notes/bravo.md -->\n\nBravo body');
});
