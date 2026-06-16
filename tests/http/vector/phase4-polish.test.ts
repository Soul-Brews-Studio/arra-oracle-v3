import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { QueryCache } from '../../../src/vector/query-cache.ts';
import type { EmbeddingProvider, VectorQueryResult } from '../../../src/vector/types.ts';

const models = {
  local: { collection: 'local_docs', model: 'bge-m3', adapter: 'lancedb' as const },
  remote: { collection: 'remote_docs', model: 'qwen3', adapter: 'qdrant' as const },
};

function queryResult(ids: string[], distances: number[]): VectorQueryResult {
  return {
    ids,
    distances,
    documents: ids.map((id) => `${id} body`),
    metadatas: ids.map(() => ({ type: 'note', source_file: 'note.md' })),
  };
}

test('GET /api/v1/vector/fanout merges and deduplicates parallel backend results', async () => {
  const { createFanoutEndpoint } = await import('../../../src/routes/vector/fanout.ts');
  const app = new Elysia({ prefix: '/api' }).use(createFanoutEndpoint({
    getModels: () => models,
    getStore: async (key) => ({
      query: mock(async () => key === 'local'
        ? queryResult(['same', 'local-only'], [10, 20])
        : queryResult(['same', 'remote-only'], [5, 30])),
    }),
  }));
  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/fanout?q=oracle&fanout=local,remote&limit=5&cache=false'),
  );
  const body = await res.json() as {
    backends: string[];
    backendStats: Record<string, { ok: boolean }>;
    results: Array<{ id: string; source: string }>;
    errors: Record<string, string>;
  };

  expect(res.status).toBe(200);
  expect(body.backends).toEqual(['local', 'remote']);
  expect(body.backendStats.local.ok).toBe(true);
  expect(body.backendStats.remote.ok).toBe(true);
  expect(body.results.map((item) => item.id)).toEqual(['same', 'local-only', 'remote-only']);
  expect(body.results[0].source).toBe('hybrid');
  expect(body.errors).toEqual({});
});

test('GET /api/v1/vector/fanout returns partial results and backend errors', async () => {
  const { createFanoutEndpoint } = await import('../../../src/routes/vector/fanout.ts');
  const app = new Elysia({ prefix: '/api' }).use(createFanoutEndpoint({
    getModels: () => models,
    getStore: async (key) => ({
      query: mock(async () => {
        if (key === 'remote') throw new Error('remote unavailable');
        return queryResult(['local-only'], [3]);
      }),
    }),
  }));
  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/fanout?q=oracle&fanout=local,remote&cache=false'),
  );
  const body = await res.json() as {
    backendStats: Record<string, { ok: boolean; error?: string }>;
    results: Array<{ id: string }>;
    errors: Record<string, string>;
  };

  expect(res.status).toBe(200);
  expect(body.results.map((item) => item.id)).toEqual(['local-only']);
  expect(body.errors.remote).toBe('remote unavailable');
  expect(body.backendStats.local.ok).toBe(true);
  expect(body.backendStats.remote).toMatchObject({ ok: false, error: 'remote unavailable' });
});

test('GET /api/v1/vector/fanout caches and clears query results', async () => {
  const { createFanoutEndpoint } = await import('../../../src/routes/vector/fanout.ts');
  const cache = new QueryCache<unknown>();
  const query = mock(async () => queryResult(['cached'], [1]));
  const app = new Elysia({ prefix: '/api' }).use(createFanoutEndpoint({
    getModels: () => ({ local: models.local }),
    getStore: async () => ({ query }),
    cache,
  }));
  const fetch = createApiVersionedFetch((request) => app.handle(request));

  const first = await fetch(new Request('http://local/api/v1/vector/fanout?q=cache&fanout=local'));
  const second = await fetch(new Request('http://local/api/v1/vector/fanout?q=cache&fanout=local'));
  const cached = await second.json() as { cached?: boolean };
  const stats = await (await fetch(new Request('http://local/api/v1/vector/fanout/cache'))).json() as { cache: { size: number } };
  const cleared = await (await fetch(new Request('http://local/api/v1/vector/fanout/cache', { method: 'DELETE' }))).json() as { cache: { size: number } };

  expect(first.status).toBe(200);
  expect(cached.cached).toBe(true);
  expect(query).toHaveBeenCalledTimes(1);
  expect(stats.cache.size).toBeGreaterThanOrEqual(1);
  expect(cleared.cache.size).toBe(0);
});

test('GET /api/v1/vector/cost-estimate returns token cost and recommendation', async () => {
  const { createVectorCostEndpoint } = await import('../../../src/routes/vector/cost.ts');
  const app = new Elysia({ prefix: '/api' }).use(createVectorCostEndpoint({
    getModels: () => models,
    getCount: async (key) => key === 'local' ? 10 : 20,
    detectProviders: async () => ({ providers: [{ type: 'gemini', available: true }] }),
  }));
  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/cost-estimate?provider=openai&tokensPerDoc=500'),
  );
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body.docs).toBe(30);
  expect(body.totalTokens).toBe(15_000);
  expect(body.estimatedUsd).toBe(0.0003);
  expect(String(body.formula)).toContain('30 docs');
  expect(String(body.recommendation)).toContain('Any configured');
});

test('buildVectorFreshness reports pending source documents', async () => {
  const { buildVectorFreshness } = await import('../../../src/vector/health.ts');
  const freshness = buildVectorFreshness([
    { count: 12 },
    { count: 3 },
  ], { docs: 20, lastIndexed: '2026-06-16T00:00:00Z' });

  expect(freshness).toEqual({
    status: 'stale',
    totalIndexed: 15,
    sourceDocs: 20,
    docsPending: 8,
    lastIndexed: '2026-06-16T00:00:00Z',
  });
});

test('FallbackEmbeddings switches to the next provider after primary failure', async () => {
  const { FallbackEmbeddings } = await import('../../../src/vector/embeddings.ts');
  const events: Array<{ from: string; to?: string }> = [];
  const failing: EmbeddingProvider = {
    name: 'ollama',
    dimensions: 3,
    embed: mock(async () => { throw new Error('ollama down'); }),
  };
  const fallback: EmbeddingProvider = {
    name: 'gemini',
    dimensions: 3,
    embed: mock(async () => [[1, 2, 3]]),
  };

  const provider = new FallbackEmbeddings([failing, fallback], (event) => events.push(event));
  await expect(provider.embed(['hello'], 'passage')).resolves.toEqual([[1, 2, 3]]);
  expect(failing.embed).toHaveBeenCalled();
  expect(fallback.embed).toHaveBeenCalled();
  expect(events).toEqual([{ from: 'ollama', to: 'gemini', error: 'ollama down' }]);
});
