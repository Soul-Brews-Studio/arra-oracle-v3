import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorExportEndpoint } from '../../../src/routes/vector/export.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

type Doc = { id: string; document: string; metadata: Record<string, unknown> };

function createStore(rows: Doc[] = []): VectorStoreAdapter {
  return {
    name: 'fake-vector',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count: rows.length })),
    getCollectionInfo: mock(async () => ({ count: rows.length, name: 'fake' })),
    getAllEmbeddings: mock(async () => ({
      ids: rows.map((doc) => doc.id),
      documents: rows.map((doc) => doc.document),
      embeddings: rows.map(() => [0, 0, 0]),
      metadatas: rows.map((doc) => doc.metadata),
    })),
  };
}

function createFetch(store: VectorStoreAdapter, collections: string[] = []) {
  const seen: string[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createVectorExportEndpoint({
    getModels: () => Object.fromEntries(collections.map((key) => [key, {}])),
    getStore: (collection) => { seen.push(collection ?? ''); return store; },
  }));
  return { seen, fetcher: createApiVersionedFetch((request) => app.handle(request)) };
}

test('GET /api/v1/vector/export rejects bad formats before opening a store', async () => {
  const { seen, fetcher } = createFetch(createStore(), ['bge-m3']);
  const res = await fetcher(new Request('http://local/api/v1/vector/export?format=zip'));
  const body = await res.json() as { error: string; formats: Array<{ format: string }> };

  expect(res.status).toBe(400);
  expect(body.error).toBe('Invalid format');
  expect(body.formats.map((item) => item.format)).toEqual(['csv', 'json', 'jsonl', 'markdown', 'v2']);
  expect(seen).toEqual([]);
});

test('GET /api/v1/vector/export reports unknown collections without default fallback', async () => {
  const { seen, fetcher } = createFetch(createStore(), ['bge-m3']);
  const res = await fetcher(new Request(
    'http://local/api/v1/vector/export?collection=missing&format=json',
  ));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(404);
  expect(body).toEqual({ error: 'Unknown vector collection: missing' });
  expect(seen).toEqual([]);
});

test('GET /api/v1/vector/export streams empty json/jsonl/csv/markdown consistently', async () => {
  const store = createStore();
  const { fetcher } = createFetch(store, ['bge-m3']);

  const json = await fetcher(new Request('http://local/api/v1/vector/export?format=json'));
  expect(json.status).toBe(200);
  expect(await json.json()).toEqual([]);

  const jsonl = await fetcher(new Request('http://local/api/v1/vector/export?format=jsonl'));
  expect(jsonl.status).toBe(200);
  expect(await jsonl.text()).toBe('');

  const csv = await fetcher(new Request('http://local/api/v1/vector/export?format=csv'));
  expect(csv.status).toBe(200);
  expect(await csv.text()).toBe('id,document,type,source_file,concepts\n');

  const markdown = await fetcher(new Request('http://local/api/v1/vector/export?format=markdown'));
  expect(markdown.status).toBe(200);
  expect(await markdown.text()).toBe('');
});
