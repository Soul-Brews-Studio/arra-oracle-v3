import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createApiVersionHeaderMiddleware,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

function createFetch() {
  const app = new Elysia()
    .use(createApiVersionHeaderMiddleware())
    .use(createHealthRoutes({
      uptimeSeconds: () => 1,
      vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
    }));

  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/health responds directly for infrastructure probes', async () => {
  const res = await createFetch()(new Request('http://local/api/health'));
  const body = await res.json() as { status: string };

  expect(res.status).toBe(200);
  expect(res.headers.get('location')).toBeNull();
  expect(res.headers.get('x-api-version')).toBe('v1');
  expect(body.status).toBe('ok');
});

test('GET /api/v1/health still rewrites to the health route', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/health'));
  const body = await res.json() as { status: string };

  expect(res.status).toBe(200);
  expect(body.status).toBe('ok');
});
