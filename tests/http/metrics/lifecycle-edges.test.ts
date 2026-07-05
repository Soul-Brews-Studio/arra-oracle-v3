import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createMetricsLifecycle,
  createMetricsTracker,
} from '../../../src/routes/metrics/index.ts';

test('metrics lifecycle records errored requests and clears active connections', async () => {
  let now = 1_000;
  const tracker = createMetricsTracker({ startedAtMs: 1_000, nowMs: () => now });
  const app = new Elysia()
    .use(createMetricsLifecycle(tracker))
    .get('/api/fail', () => {
      now += 17;
      throw new Error('boom');
    });

  const res = await app.handle(new Request('http://local/api/fail'));

  expect(res.status).toBe(500);
  expect(tracker.snapshot()).toMatchObject({
    requestCount: 1,
    avgResponseMs: 17,
    activeConnections: 0,
  });
});

test('metrics snapshots clamp non-finite and negative memory readings', () => {
  const tracker = createMetricsTracker({
    startedAtMs: 0,
    nowMs: () => 1_000,
    memoryUsage: () => ({
      rss: -1,
      heapTotal: Number.NaN,
      heapUsed: Number.POSITIVE_INFINITY,
      external: 12.5,
      arrayBuffers: 0,
    }),
  });

  expect(tracker.snapshot().memoryUsage).toEqual({
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 12.5,
    arrayBuffers: 0,
  });
});
