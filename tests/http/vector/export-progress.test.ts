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
      ids: ['doc-1', 'doc-2', 'doc-3'],
      documents: ['alpha', 'bravo', 'charlie'],
      embeddings: [[0], [1], [2]],
      metadatas: [{}, {}, {}],
    })),
  };
}

function sseData(body: string): Array<Record<string, unknown>> {
  return [...body.matchAll(/^data: (.+)$/gm)].map((match) => JSON.parse(match[1]));
}

test('GET /api/v1/vector/export/progress streams document progress events', async () => {
  const store = createStore();
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({ getStore: () => store }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetcher(new Request('http://local/api/v1/vector/export/progress?collection=bge-m3'));
  const body = await res.text();
  const events = sseData(body);

  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('cache-control')).toContain('no-cache');
  expect(body).toContain('event: progress');
  expect(body).toContain('event: complete');
  expect(events[0]).toEqual({ status: 'starting', processed: 0, total: 3 });
  expect(events.at(-1)).toEqual({ status: 'completed', processed: 3, total: 3 });
  expect(store.getAllEmbeddings).toHaveBeenCalledWith(3);
});
