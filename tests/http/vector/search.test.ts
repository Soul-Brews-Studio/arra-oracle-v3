import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorSearchEndpoint } from '../../../src/routes/vector/search.ts';
import type { VectorQueryResult } from '../../../src/vector/types.ts';

function createFetch(result: VectorQueryResult, collections = ['bge-m3', 'qwen3']) {
  const requested: string[] = [];
  const store = {
    connect: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    query: mock(async () => result),
    getStats: mock(async () => ({ count: result.ids.length })),
  };
  const app = new Elysia({ prefix: '/api' }).use(createVectorSearchEndpoint({
    getModels: () => Object.fromEntries(collections.map((name) => [name, {}])),
    getStore: (collection) => {
      requested.push(collection ?? '');
      return store;
    },
  }));
  return { fetcher: createApiVersionedFetch((request) => app.handle(request)), requested, store };
}

const result: VectorQueryResult = {
  ids: ['doc-a', 'doc-b', 'doc-c', 'doc-d'],
  documents: ['alpha', 'bravo', 'charlie', 'delta'],
  distances: [0.2, 0.1, 0.3, 0.4],
  metadatas: [
    { type: 'note', origin: 'human', source_file: 'notes/a.md', created_at: '2026-01-01T00:00:00.000Z', concepts: '["a"]' },
    { type: 'note', origin: 'human', source_file: 'notes/b.md', created_at: '2026-01-02T00:00:00.000Z', concepts: ['b'] },
    { type: 'note', origin: 'human', source_file: 'notes/c.md', created_at: '2026-01-03T00:00:00.000Z' },
    { type: 'note', origin: 'system', source_file: 'notes/d.md', created_at: '2026-01-04T00:00:00.000Z' },
  ],
};

test('GET /api/v1/vector/search filters selected collection before paginating sorted results', async () => {
  const { fetcher, requested, store } = createFetch(result);
  const url = new URL('http://local/api/v1/vector/search');
  url.search = new URLSearchParams({
    q: 'oracle',
    collection: 'qwen3',
    type: 'note',
    'metadata.origin': 'human',
    from: '2026-01-01',
    to: '2026-01-03T23:59:59.999Z',
    sort: 'date',
    order: 'asc',
    limit: '1',
    offset: '1',
  }).toString();

  const res = await fetcher(new Request(url));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(requested).toEqual(['qwen3']);
  expect(store.query).toHaveBeenCalledWith('oracle', 5, { origin: 'human', type: 'note' });
  expect(body.total).toBe(3);
  expect(body.offset).toBe(1);
  expect(body.limit).toBe(1);
  expect(body.collection).toBe('qwen3');
  expect(body.sort).toEqual({ field: 'date', order: 'asc' });
  expect(body.results).toEqual([expect.objectContaining({
    id: 'doc-b',
    content: 'bravo',
    source_file: 'notes/b.md',
    metadata: expect.objectContaining({ origin: 'human' }),
    concepts: ['b'],
  })]);
});

test('GET /api/v1/vector/search accepts JSON metadata filters and distance sort', async () => {
  const { fetcher } = createFetch(result);
  const metadata = encodeURIComponent(JSON.stringify({ origin: 'human' }));
  const res = await fetcher(new Request(
    `http://local/api/v1/vector/search?q=oracle&metadata=${metadata}&sort=distance&limit=2`,
  ));
  const body = await res.json() as { results: Array<{ id: string }>; sort: Record<string, string> };

  expect(res.status).toBe(200);
  expect(body.sort).toEqual({ field: 'distance', order: 'asc' });
  expect(body.results.map((item) => item.id)).toEqual(['doc-b', 'doc-a']);
});

test('GET /api/v1/vector/search rejects bad filters and unknown collections', async () => {
  const badMetadata = await createFetch(result).fetcher(new Request(
    'http://local/api/v1/vector/search?q=oracle&metadata=not-json',
  ));
  expect(badMetadata.status).toBe(400);
  expect(await badMetadata.json()).toMatchObject({ error: 'Invalid metadata filter' });

  const unknown = await createFetch(result, ['bge-m3']).fetcher(new Request(
    'http://local/api/v1/vector/search?q=oracle&collection=missing',
  ));
  expect(unknown.status).toBe(404);
  expect(await unknown.json()).toEqual({ error: 'Unknown vector collection: missing' });
});
