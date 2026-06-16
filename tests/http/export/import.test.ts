import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createExportImportRoutes } from '../../../src/routes/export/import.ts';
import type { VectorDocument } from '../../../src/vector/types.ts';

function createStore() {
  const batches: VectorDocument[][] = [];
  const store = {
    connect: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    addDocuments: mock(async (docs: VectorDocument[]) => {
      batches.push(docs);
    }),
  };
  return { store, batches };
}

function createFetch(store: ReturnType<typeof createStore>['store'], collections: string[] = ['bge-m3']) {
  const requested: string[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createExportImportRoutes({
    getModels: () => Object.fromEntries(collections.map((name) => [name, {}])),
    getStore: (collection) => {
      requested.push(collection ?? '');
      return store;
    },
    chunkSize: 2,
  }));
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), requested };
}

function multipart(file: Blob, filename: string, collection = 'bge-m3', format?: string): FormData {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('collection', collection);
  if (format) form.append('format', format);
  return form;
}

test('POST /api/v1/export/import restores uploaded JSONL rows into a vector collection', async () => {
  const { store, batches } = createStore();
  const { fetcher, requested } = createFetch(store);
  const body = [
    JSON.stringify({ id: 'doc-1', document: 'alpha', type: 'learning', source_file: 'notes/a.md', concepts: ['a'] }),
    JSON.stringify({ id: 'doc-2', document: 'bravo', type: 'trace', sourceFile: 'traces/b.md' }),
  ].join('\n');

  const res = await fetcher(new Request('http://local/api/v1/export/import', {
    method: 'POST',
    body: multipart(new Blob([body], { type: 'application/x-ndjson' }), 'export.jsonl'),
  }));
  const payload = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(payload).toEqual({ success: true, collection: 'bge-m3', format: 'jsonl', imported: 2, skipped: 0 });
  expect(requested).toEqual(['bge-m3']);
  expect(store.connect).toHaveBeenCalledTimes(1);
  expect(store.ensureCollection).toHaveBeenCalledTimes(1);
  expect(batches).toEqual([[
    { id: 'doc-1', document: 'alpha', metadata: { type: 'learning', source_file: 'notes/a.md', concepts: '["a"]' } },
    { id: 'doc-2', document: 'bravo', metadata: { type: 'trace', sourceFile: 'traces/b.md' } },
  ]]);
});

test('POST /api/v1/export/import accepts JSON export arrays with vectors', async () => {
  const { store, batches } = createStore();
  const { fetcher } = createFetch(store);
  const rows = [
    { id: 'doc-3', document: 'charlie', metadata: { type: 'note', rank: 3 }, vector: [0.1, 0.2, 0.3] },
    { id: 'skip-me', metadata: { type: 'empty' } },
  ];

  const res = await fetcher(new Request('http://local/api/v1/export/import', {
    method: 'POST',
    body: multipart(new Blob([JSON.stringify(rows)], { type: 'application/json' }), 'export.json'),
  }));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, collection: 'bge-m3', format: 'json', imported: 1, skipped: 1 });
  expect(batches).toEqual([[
    { id: 'doc-3', document: 'charlie', metadata: { type: 'note', rank: 3 }, vector: [0.1, 0.2, 0.3] },
  ]]);
});

test('POST /api/v1/export/import rejects unknown vector collections', async () => {
  const { store, batches } = createStore();
  const { fetcher } = createFetch(store, ['bge-m3']);
  const file = new Blob([JSON.stringify([{ id: 'doc-1', document: 'alpha' }])], { type: 'application/json' });

  const res = await fetcher(new Request('http://local/api/v1/export/import', {
    method: 'POST',
    body: multipart(file, 'export.json', 'missing'),
  }));

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Unknown vector collection: missing' });
  expect(batches).toEqual([]);
  expect(store.addDocuments).not.toHaveBeenCalled();
});
