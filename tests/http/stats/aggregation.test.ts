import { describe, expect, test } from 'bun:test';
import { createRequestStatsTracker } from '../../../src/routes/stats/index.ts';
import type { RequestLogEntry } from '../../../src/middleware/logger.ts';

let now = Date.parse('2026-06-16T12:00:30.000Z');

function entry(path: string, status: number, durationMs: number): RequestLogEntry {
  return {
    event: 'http_request',
    method: 'GET',
    path,
    status,
    durationMs,
    correlationId: 'test-id',
    headers: {},
  };
}

describe('request stats aggregation', () => {
  test('tracks totals, per-route counts, average latency, error rate, and minute buckets', () => {
    const tracker = createRequestStatsTracker({ nowMs: () => now });
    tracker.record(entry('/ok', 200, 10));
    tracker.record(entry('/ok', 500, 30));
    now += 60_000;
    tracker.record(entry('/other', 404, 20));

    const snapshot = tracker.snapshot();
    const nonEmptyBuckets = snapshot.requestsPerMinute.filter((bucket) => bucket.count > 0);

    expect(snapshot.totalRequests).toBe(3);
    expect(snapshot.requestsPerRoute).toEqual({ '/ok': 2, '/other': 1 });
    expect(snapshot.averageResponseTimeMs).toBe(20);
    expect(snapshot.errorRate).toBe(0.67);
    expect(snapshot.requestsPerMinute).toHaveLength(60);
    expect(nonEmptyBuckets.map((bucket) => bucket.count)).toEqual([2, 1]);
  });
});
