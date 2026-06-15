import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { API_VERSION_HEADER, createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorHealthEndpoint } from '../../../src/routes/vector/health.ts';
import { createVectorModelEndpoints } from '../../../src/routes/vector/indexer.ts';
import type { EmbeddingModelConfig } from '../../../src/vector/factory.ts';

const models = {
  'bge-m3': { collection: 'oracle_bge', model: 'bge-m3', adapter: 'lancedb' },
  qdrant: { collection: 'oracle_qdrant', model: 'qdrant-embed', adapter: 'qdrant' },
} satisfies Record<string, EmbeddingModelConfig>;

function createFetch() {
  const app = new Elysia({ prefix: '/api' })
    .use(createVectorHealthEndpoint({
      proxy: null,
      vectorHealth: async () => ({
        status: 'ok',
        checked_at: '2026-06-16T00:00:00.000Z',
        engines: [
          { key: 'bge-m3', model: 'bge-m3', collection: 'oracle_bge', ok: true },
          { key: 'qdrant', model: 'qdrant-embed', collection: 'oracle_qdrant', ok: true },
        ],
      }),
    }))
    .use(createVectorModelEndpoints({
      getModels: () => models,
      createStore: (preset) => ({
        connect: async () => {},
        getStats: async () => ({ count: preset.collection === 'oracle_bge' ? 12 : 3 }),
        close: async () => {},
      }),
    }));

  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/v1/vector/status and /api/v1/vector/models return vector status shapes', async () => {
  const fetcher = createFetch();

  const statusRes = await fetcher(new Request('http://local/api/v1/vector/status'));
  const statusBody = await statusRes.json() as Record<string, any>;
  expect(statusRes.status).toBe(200);
  expect(statusRes.headers.get(API_VERSION_HEADER)).toBe('v1');
  expect(statusBody).toMatchObject({
    status: 'ok',
    checked_at: '2026-06-16T00:00:00.000Z',
    engines: [
      { key: 'bge-m3', model: 'bge-m3', collection: 'oracle_bge', ok: true },
      { key: 'qdrant', model: 'qdrant-embed', collection: 'oracle_qdrant', ok: true },
    ],
  });

  const modelsRes = await fetcher(new Request('http://local/api/v1/vector/models'));
  const modelsBody = await modelsRes.json() as Record<string, any>;
  expect(modelsRes.status).toBe(200);
  expect(modelsRes.headers.get(API_VERSION_HEADER)).toBe('v1');
  expect(modelsBody).toMatchObject({
    models: {
      'bge-m3': { collection: 'oracle_bge', model: 'bge-m3', adapter: 'lancedb', count: 12 },
      qdrant: { collection: 'oracle_qdrant', model: 'qdrant-embed', adapter: 'qdrant', count: 3 },
    },
  });
});
