import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createMetricsLifecycle,
  createMetricsRoutes,
  createMetricsTracker,
} from '../../../src/routes/metrics/index.ts';

test('GET /api/metrics reports lifecycle-tracked runtime counters', async () => {
  let now = 1_000;
  const tracker = createMetricsTracker({
    startedAtMs: 0,
    lastRestart: '2026-06-16T00:00:00.000Z',
    nowMs: () => now,
    memoryUsage: () => ({ rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 }),
  });
  const app = new Elysia()
    .use(createMetricsLifecycle(tracker))
    .get('/api/ping', () => {
      now += 25;
      return { ok: true };
    })
    .use(createMetricsRoutes(tracker));

  const ping = await app.handle(new Request('http://local/api/ping'));
  expect(ping.status).toBe(200);

  const res = await app.handle(new Request('http://local/api/metrics'));
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, unknown>;

  expect(body).toMatchObject({
    uptime: 1.025,
    requestCount: 1,
    avgResponseMs: 25,
    lastResponseMs: 25,
    maxResponseMs: 25,
    activeConnections: 1,
    errorCount: 0,
    statusCounts: { '2xx': 1 },
    methodCounts: { GET: 1 },
    lastRestart: '2026-06-16T00:00:00.000Z',
    memoryUsage: { rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 },
  });
});
