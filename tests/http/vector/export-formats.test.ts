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
      ids: ['doc-1'],
      documents: ['alpha document'],
      embeddings: [[0, 0, 0]],
      metadatas: [{ type: 'learning', source_file: 'notes/alpha.md', concepts: ['alpha'] }],
    })),
  };
}

function createFetch() {
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore: () => createStore() }));
  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/v1/vector/export/formats lists available export formats', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/vector/export/formats'));
  const formats = await res.json() as string[];

  expect(res.status).toBe(200);
  expect(Array.isArray(formats)).toBe(true);
  expect(formats).toContain('json');
  expect(formats).toContain('csv');
  expect(formats).toContain('jsonl');
});

test('GET /api/v1/vector/export supports jsonl format', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/vector/export?collection=bge-m3&format=jsonl'));
  const text = await res.text();

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/x-ndjson');
  expect(JSON.parse(text.trim())).toMatchObject({ id: 'doc-1', document: 'alpha document' });
});
