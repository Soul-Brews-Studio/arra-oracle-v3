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

test('POST /api/v1/export/import accepts a single JSON document export', async () => {
  const { store, batches } = createStore();
  const { fetcher } = createFetch(store);
  const exportedDoc = {
    version: 1,
    id: 'doc-json-1',
    source: 'psi/restore/json.md',
    content: 'single JSON document body',
    concepts: ['json', 'restore'],
    metadata: { type: 'learning', source_file: 'psi/restore/json.md' },
  };

  const res = await fetcher(new Request('http://local/api/v1/export/import', {
    method: 'POST',
    body: multipart(new Blob([JSON.stringify(exportedDoc)], { type: 'application/json' }), 'doc-json-1.json'),
  }));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, collection: 'bge-m3', format: 'json', imported: 1, skipped: 0 });
  expect(batches[0]?.[0]).toMatchObject({
    id: 'doc-json-1',
    document: 'single JSON document body',
    metadata: { type: 'learning', source_file: 'psi/restore/json.md', source: 'psi/restore/json.md' },
  });
});

test('POST /api/v1/export/import accepts Markdown document uploads', async () => {
  const { store, batches } = createStore();
  const { fetcher } = createFetch(store);
  const markdown = [
    '---',
    'id: "doc-md-1"',
    'source_file: "psi/restore/doc-md-1.md"',
    'type: "learning"',
    'concepts:',
    '  - restore',
    '  - markdown',
    '---',
    '',
    '# Restored Markdown',
    '',
    'Markdown restore body.',
  ].join('\n');

  const res = await fetcher(new Request('http://local/api/v1/export/import', {
    method: 'POST',
    body: multipart(new Blob([markdown], { type: 'text/markdown' }), 'doc-md-1.md'),
  }));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, collection: 'bge-m3', format: 'markdown', imported: 1, skipped: 0 });
  expect(batches[0]?.[0]).toMatchObject({
    id: 'doc-md-1',
    document: '# Restored Markdown\n\nMarkdown restore body.',
    metadata: {
      import_format: 'markdown',
      source_file: 'psi/restore/doc-md-1.md',
      type: 'learning',
      concepts: '["restore","markdown"]',
    },
  });
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
