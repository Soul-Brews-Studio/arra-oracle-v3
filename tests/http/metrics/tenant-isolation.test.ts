import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import {
  createMetricsLifecycle,
  createMetricsRoutes,
  createMetricsTracker,
} from '../../../src/routes/metrics/index.ts';

test('GET /api/metrics reports counters for only the active tenant', async () => {
  let now = 1_000;
  const tracker = createMetricsTracker({
    startedAtMs: 0,
    lastRestart: '2026-06-16T00:00:00.000Z',
    nowMs: () => now,
    memoryUsage: () => ({ rss: 1, heapTotal: 2, heapUsed: 3, external: 4, arrayBuffers: 5 }),
  });
  const app = new Elysia()
    .use(createMetricsLifecycle(tracker))
    .get('/api/ping', ({ request }) => {
      now += request.headers.get(TENANT_HEADER) === 'tenant-a' ? 20 : 40;
      return { ok: true };
    })
    .use(createMetricsRoutes(tracker));

  await handle(app, 'tenant-a', '/api/ping');
  await handle(app, 'tenant-b', '/api/ping');

  const tenantA = await json(handle(app, 'tenant-a', '/api/metrics'));
  const tenantB = await json(handle(app, 'tenant-b', '/api/metrics'));

  expect(tenantA).toMatchObject({
    requestCount: 1,
    avgResponseMs: 20,
    activeConnections: 1,
    tenant: { id: 'tenant-a', scope: 'tenant_id' },
  });
  expect(tenantB).toMatchObject({
    requestCount: 1,
    avgResponseMs: 40,
    activeConnections: 1,
    tenant: { id: 'tenant-b', scope: 'tenant_id' },
  });
});

function handle(app: Elysia, tenantId: string, pathname: string) {
  return createTenantFetch((request) => app.handle(request))(new Request(`http://local${pathname}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

async function json(response: Promise<Response>) {
  const res = await response;
  expect(res.status).toBe(200);
  return await res.json() as Record<string, unknown>;
}
