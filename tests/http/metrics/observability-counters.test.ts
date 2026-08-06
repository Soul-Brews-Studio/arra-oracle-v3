import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import {
  createMetricsLifecycle,
  createMetricsTracker,
} from '../../../src/routes/metrics/index.ts';

describe('metrics observability counters', () => {
  test('counts methods, status classes, errors, and response timings', async () => {
    let now = 1_000;
    const tracker = createMetricsTracker({ startedAtMs: 1_000, nowMs: () => now });
    const app = new Elysia()
      .use(createMetricsLifecycle(tracker))
      .get('/ok', () => { now += 10; return { ok: true }; })
      .post('/invalid', ({ set }) => { now += 20; set.status = 422; return { ok: false }; })
      .get('/fail', () => { now += 30; throw new Error('boom'); });

    expect((await app.handle(new Request('http://local/ok'))).status).toBe(200);
    expect((await app.handle(new Request('http://local/invalid', { method: 'POST' }))).status).toBe(422);
    expect((await app.handle(new Request('http://local/fail'))).status).toBe(500);

    expect(tracker.snapshot()).toMatchObject({
      requestCount: 3,
      avgResponseMs: 20,
      lastResponseMs: 30,
      maxResponseMs: 30,
      errorCount: 1,
      activeConnections: 0,
      statusCounts: { '2xx': 1, '4xx': 1, '5xx': 1 },
      methodCounts: { GET: 2, POST: 1 },
    });
  });

  test('uses Response.status for redirect-style handlers', async () => {
    let now = 0;
    const tracker = createMetricsTracker({ startedAtMs: 0, nowMs: () => now });
    const app = new Elysia()
      .use(createMetricsLifecycle(tracker))
      .get('/redirect', () => { now += 5; return new Response(null, { status: 302 }); });

    const res = await app.handle(new Request('http://local/redirect'));

    expect(res.status).toBe(302);
    expect(tracker.snapshot()).toMatchObject({
      requestCount: 1,
      avgResponseMs: 5,
      statusCounts: { '3xx': 1 },
      methodCounts: { GET: 1 },
    });
  });

  test('non-finite clocks do not poison snapshots or counters', () => {
    let now = Number.NaN;
    const tracker = createMetricsTracker({ startedAtMs: Number.POSITIVE_INFINITY, nowMs: () => now });
    const req = new Request('http://local/work', { method: 'PATCH' });

    tracker.begin(req);
    now = Number.NEGATIVE_INFINITY;
    tracker.end(req, 204);

    expect(tracker.snapshot()).toMatchObject({
      uptime: 0,
      requestCount: 1,
      avgResponseMs: 0,
      lastResponseMs: 0,
      maxResponseMs: 0,
      statusCounts: { '2xx': 1 },
      methodCounts: { PATCH: 1 },
    });
  });
});

describe('health rollup observability edges', () => {
  test('degrades aggregate health when embedded vector health is down', async () => {
    const app = createHealthRoutes({
      dbPing: () => ({ status: 'connected' }),
      pluginCount: 0,
      vectorHealth: async () => ({ status: 'down', checked_at: 'now', engines: [], error: 'offline' }),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    });

    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.vectorStatus).toBe('down');
    expect(body.vectorServer.status).toBe('unconfigured');
    expect(body.status).toBe(body.vectorMode === 'disabled' ? 'ok' : 'degraded');
  });
});
