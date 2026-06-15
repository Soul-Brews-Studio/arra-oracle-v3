import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createRequestLogger } from '../../../src/middleware/logger.ts';
import { createRequestStatsTracker } from '../../../src/routes/stats/index.ts';

describe('request logger stats tap', () => {
  test('records completed requests into the stats tracker', async () => {
    const tracker = createRequestStatsTracker({ nowMs: () => Date.parse('2026-06-16T12:00:00.000Z') });
    const logger = createRequestLogger({ log: () => undefined, stats: tracker });
    const app = new Elysia()
      .onRequest(logger.onRequest)
      .onAfterResponse(logger.onAfterResponse)
      .get('/logged', ({ set }) => {
        set.status = 201;
        return { ok: true };
      });

    const response = await app.fetch(new Request('http://local/logged'));
    const snapshot = await waitForStats(() => tracker.snapshot());

    expect(response.status).toBe(201);
    expect(snapshot.totalRequests).toBe(1);
    expect(snapshot.requestsPerRoute).toEqual({ '/logged': 1 });
    expect(snapshot.errorRate).toBe(0);
  });
});

async function waitForStats<T extends { totalRequests: number }>(snapshot: () => T): Promise<T> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const current = snapshot();
    if (current.totalRequests > 0) return current;
    await Bun.sleep(5);
  }
  return snapshot();
}
