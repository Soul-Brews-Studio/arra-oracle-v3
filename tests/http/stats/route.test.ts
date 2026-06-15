import { describe, expect, test } from 'bun:test';
import { createRequestStatsRoutes, createRequestStatsTracker } from '../../../src/routes/stats/index.ts';
import type { RequestLogEntry } from '../../../src/middleware/logger.ts';

const entry: RequestLogEntry = {
  event: 'http_request',
  method: 'GET',
  path: '/api/health',
  status: 200,
  durationMs: 12,
  correlationId: 'route-test',
  headers: {},
};

describe('GET /api/v1/stats', () => {
  test('returns the request stats snapshot as JSON', async () => {
    const tracker = createRequestStatsTracker({ nowMs: () => Date.parse('2026-06-16T12:00:00.000Z') });
    tracker.record(entry);
    const app = createRequestStatsRoutes(tracker);

    const response = await app.handle(new Request('http://local/api/v1/stats'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.totalRequests).toBe(1);
    expect(body.requestsPerRoute).toEqual({ '/api/health': 1 });
    expect(body.averageResponseTimeMs).toBe(12);
    expect(body.errorRate).toBe(0);
    expect(Array.isArray(body.requestsPerMinute)).toBe(true);
  });
});
