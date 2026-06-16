import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  API_VERSION_HEADER,
  createApiVersionHeaderMiddleware,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/v1/health includes vector per-collection details', async () => {
  const app = new Elysia()
    .use(createApiVersionHeaderMiddleware())
    .use(createHealthRoutes({
      pluginCount: 0,
      uptimeSeconds: () => 2,
      dbPing: () => ({ status: 'connected' }),
      vectorHealth: async () => ({
        status: 'degraded',
        checked_at: '2026-06-16T00:00:00.000Z',
        engines: [
          {
            key: 'bge-m3',
            model: 'bge-m3',
            collection: 'oracle_knowledge_bge_m3',
            adapter: 'lancedb',
            embeddingProvider: 'ollama',
            connectionStatus: 'connected',
            count: 42,
            ok: true,
          },
          {
            key: 'qwen3',
            model: 'qwen3-embedding',
            collection: 'oracle_knowledge_qwen3',
            adapter: 'qdrant',
            embeddingProvider: 'remote',
            connectionStatus: 'error',
            count: 0,
            ok: false,
            error: 'timeout',
          },
        ],
      }),
    }));
  const fetchVersioned = createApiVersionedFetch((request) => app.handle(request));

  const res = await fetchVersioned(new Request('http://local/api/v1/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(res.headers.get(API_VERSION_HEADER)).toBe('v1');
  expect(body.vectorStatus).toBe('degraded');
  expect(body.vector.collections).toEqual(body.vector.engines);
  expect(body.vector.collections).toMatchObject([
    {
      collection: 'oracle_knowledge_bge_m3',
      adapter: 'lancedb',
      connectionStatus: 'connected',
      count: 42,
      embeddingProvider: 'ollama',
      model: 'bge-m3',
    },
    {
      collection: 'oracle_knowledge_qwen3',
      adapter: 'qdrant',
      connectionStatus: 'error',
      count: 0,
      embeddingProvider: 'remote',
      model: 'qwen3-embedding',
      error: 'timeout',
    },
  ]);
});
