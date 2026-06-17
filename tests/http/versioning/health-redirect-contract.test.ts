import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  API_VERSION_HEADER,
  createApiVersionHeaderMiddleware,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

function createFetch() {
  const app = new Elysia()
    .use(createApiVersionHeaderMiddleware())
    .use(createHealthRoutes({
      dbPing: () => ({ status: 'connected' }),
      vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-17T00:00:00.000Z' }),
      diskUsage: () => ({
        status: 'ok',
        path: '/tmp/oracle',
        totalBytes: 100,
        freeBytes: 80,
        usedBytes: 20,
        usedPercent: 20,
      }),
      memoryUsage: () => ({ rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }),
    }));
  return createApiVersionedFetch((request) => app.handle(request));
}

test('only exact /api/health bypasses bare /api redirecting', async () => {
  const fetcher = createFetch();

  const health = await fetcher(new Request('http://local/api/health?probe=1'));
  expect(health.status).toBe(200);
  expect(health.headers.get('location')).toBeNull();
  expect(health.headers.get(API_VERSION_HEADER)).toBe('v1');

  const trailing = await fetcher(new Request('http://local/api/health/'));
  expect(trailing.status).toBe(308);
  expect(trailing.headers.get('location')).toBe('http://local/api/v1/health/');

  const deep = await fetcher(new Request('http://local/api/health/deep?probe=1'));
  expect(deep.status).toBe(308);
  expect(deep.headers.get('location')).toBe('http://local/api/v1/health/deep?probe=1');
});

test('versioned health children rewrite to the unversioned route internals', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/health/deep'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(res.headers.get(API_VERSION_HEADER)).toBe('v1');
  expect(body.status).toBe('ok');
  expect(body.db).toMatchObject({ status: 'connected' });
});
