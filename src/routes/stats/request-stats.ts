import type { RequestLogEntry } from '../../middleware/logger.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

type RouteCounters = { count: number; totalDurationMs: number; errors: number };
type RecentRequest = { atMs: number };

export interface RequestStatsSnapshot {
  totalRequests: number;
  requestsPerRoute: Record<string, number>;
  averageResponseTimeMs: number;
  errorRate: number;
  requestsPerMinute: Array<{ minute: string; count: number }>;
}

export interface RequestStatsTrackerOptions {
  nowMs?: () => number;
}

export interface RequestStatsTracker {
  record(entry: RequestLogEntry): void;
  reset(): void;
  snapshot(): RequestStatsSnapshot;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function minuteStart(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

function isErrorStatus(status: number): boolean {
  return status >= 400;
}

function emptySnapshot(nowMs: number): RequestStatsSnapshot {
  return {
    totalRequests: 0,
    requestsPerRoute: {},
    averageResponseTimeMs: 0,
    errorRate: 0,
    requestsPerMinute: minuteBuckets(nowMs, []),
  };
}

export function createRequestStatsTracker(options: RequestStatsTrackerOptions = {}): RequestStatsTracker {
  const nowMs = options.nowMs ?? (() => Date.now());
  const routeCounters = new Map<string, RouteCounters>();
  const recentRequests: RecentRequest[] = [];
  let totalRequests = 0;
  let totalDurationMs = 0;
  let totalErrors = 0;

  function pruneRecent(now = nowMs()): void {
    const cutoff = now - HOUR_MS;
    while (recentRequests[0] && recentRequests[0].atMs < cutoff) recentRequests.shift();
  }

  return {
    record(entry) {
      const route = entry.path;
      const existing = routeCounters.get(route) ?? { count: 0, totalDurationMs: 0, errors: 0 };
      existing.count += 1;
      existing.totalDurationMs += entry.durationMs;
      if (isErrorStatus(entry.status)) existing.errors += 1;
      routeCounters.set(route, existing);

      totalRequests += 1;
      totalDurationMs += entry.durationMs;
      if (isErrorStatus(entry.status)) totalErrors += 1;
      recentRequests.push({ atMs: nowMs() });
      pruneRecent();
    },
    reset() {
      routeCounters.clear();
      recentRequests.length = 0;
      totalRequests = 0;
      totalDurationMs = 0;
      totalErrors = 0;
    },
    snapshot() {
      pruneRecent();
      if (totalRequests === 0) return emptySnapshot(nowMs());
      return {
        totalRequests,
        requestsPerRoute: Object.fromEntries([...routeCounters].map(([route, counters]) => [route, counters.count])),
        averageResponseTimeMs: round(totalDurationMs / totalRequests),
        errorRate: round(totalErrors / totalRequests),
        requestsPerMinute: minuteBuckets(nowMs(), recentRequests),
      };
    },
  };
}

function minuteBuckets(nowMs: number, requests: RecentRequest[]): Array<{ minute: string; count: number }> {
  const end = minuteStart(nowMs);
  const start = end - (59 * MINUTE_MS);
  const counts = new Map<number, number>();
  for (const request of requests) {
    const minute = minuteStart(request.atMs);
    if (minute < start || minute > end) continue;
    counts.set(minute, (counts.get(minute) ?? 0) + 1);
  }
  return Array.from({ length: 60 }, (_, index) => {
    const minute = start + (index * MINUTE_MS);
    return { minute: new Date(minute).toISOString(), count: counts.get(minute) ?? 0 };
  });
}

export const serverRequestStats = createRequestStatsTracker();
