import { expect, test } from 'bun:test';
import {
  createMetricsRoutes,
  createMetricsTracker,
} from '../../../src/routes/metrics/index.ts';

test('metrics tracker ignores duplicate begin calls and clamps backward clocks', () => {
  let now = 1_000;
  const tracker = createMetricsTracker({ startedAtMs: 2_000, nowMs: () => now });
  const request = new Request('http://local/api/work');

  tracker.begin(request);
  tracker.begin(request);
  now = 900;
  tracker.end(request);
  tracker.end(request);

  expect(tracker.snapshot()).toMatchObject({
    uptime: 0,
    requestCount: 1,
    avgResponseMs: 0,
    activeConnections: 0,
  });
});

test('metrics route returns sanitized memory values when collection fails', async () => {
  const tracker = createMetricsTracker({
    startedAtMs: 0,
    nowMs: () => 1_000,
    memoryUsage: () => { throw new Error('memory unavailable'); },
  });
  const res = await createMetricsRoutes(tracker).handle(new Request('http://local/api/metrics'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body.memoryUsage).toEqual({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 });
});
