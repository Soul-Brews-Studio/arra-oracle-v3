import { describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createContentTypeMiddleware } from '../../../src/middleware/content-type.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

type ExportCase = { format: string; accept: string; contentType: string; body: (text: string) => void };

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
  const app = new Elysia({ prefix: '/api' })
    .use(createContentTypeMiddleware())
    .use(createVectorExportEndpoint({
      getModels: () => ({ 'bge-m3': {} }),
      getStore: () => createStore(),
    }));
  return createApiVersionedFetch((request) => app.handle(request));
}

const cases: ExportCase[] = [
  { format: 'json', accept: 'application/json', contentType: 'application/json', body: (text) => expect(JSON.parse(text)[0].id).toBe('doc-1') },
  { format: 'jsonl', accept: 'application/x-ndjson', contentType: 'application/x-ndjson', body: (text) => expect(JSON.parse(text.trim()).id).toBe('doc-1') },
  { format: 'csv', accept: 'text/csv', contentType: 'text/csv', body: (text) => expect(text).toStartWith('id,document,type,source_file,concepts') },
  { format: 'markdown', accept: 'text/markdown', contentType: 'text/markdown', body: (text) => expect(text).toContain('<!-- source: notes/alpha.md -->') },
];

describe('vector export with global content-type middleware', () => {
  for (const item of cases) {
    test(`returns ${item.format} with ${item.contentType} instead of 406`, async () => {
      const res = await createFetch()(new Request(
        `http://local/api/v1/vector/export?collection=bge-m3&format=${item.format}`,
        { headers: { accept: item.accept } },
      ));
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(item.contentType);
      item.body(text);
    });
  }
});
