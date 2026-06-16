import { Elysia, t } from 'elysia';

export interface MemoryUsageSnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface MetricsSnapshot {
  uptime: number;
  requestCount: number;
  avgResponseMs: number;
  activeConnections: number;
  lastRestart: string;
  memoryUsage: MemoryUsageSnapshot;
}

export interface MetricsTrackerOptions {
  startedAtMs?: number;
  nowMs?: () => number;
  lastRestart?: string;
  memoryUsage?: () => MemoryUsageSnapshot;
}

export interface MetricsTracker {
  begin(request: Request): void;
  end(request: Request): void;
  snapshot(): MetricsSnapshot;
}

const MemoryUsageSchema = t.Object({
  rss: t.Number(),
  heapTotal: t.Number(),
  heapUsed: t.Number(),
  external: t.Number(),
  arrayBuffers: t.Number(),
});

const MetricsResponseSchema = t.Object({
  uptime: t.Number(),
  requestCount: t.Number(),
  avgResponseMs: t.Number(),
  activeConnections: t.Number(),
  lastRestart: t.String(),
  memoryUsage: MemoryUsageSchema,
});

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function processMemoryUsage(): MemoryUsageSnapshot {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers ?? 0,
  };
}

export function createMetricsTracker(options: MetricsTrackerOptions = {}): MetricsTracker {
  const nowMs = options.nowMs ?? (() => Date.now());
  const startedAtMs = options.startedAtMs ?? nowMs();
  const lastRestart = options.lastRestart ?? new Date(startedAtMs).toISOString();
  const memoryUsage = options.memoryUsage ?? processMemoryUsage;
  const starts = new WeakMap<Request, number>();
  let requestCount = 0;
  let totalResponseMs = 0;
  let activeConnections = 0;

  return {
    begin(request) {
      activeConnections += 1;
      starts.set(request, nowMs());
    },
    end(request) {
      const started = starts.get(request);
      if (started === undefined) return;
      starts.delete(request);
      activeConnections = Math.max(0, activeConnections - 1);
      requestCount += 1;
      totalResponseMs += Math.max(0, nowMs() - started);
    },
    snapshot() {
      return {
        uptime: round((nowMs() - startedAtMs) / 1000),
        requestCount,
        avgResponseMs: requestCount === 0 ? 0 : round(totalResponseMs / requestCount),
        activeConnections,
        lastRestart,
        memoryUsage: memoryUsage(),
      };
    },
  };
}

export const serverMetrics = createMetricsTracker();

export function createMetricsLifecycle(tracker: MetricsTracker = serverMetrics) {
  return new Elysia({ name: 'metrics-lifecycle' })
    .onRequest(({ request }) => {
      tracker.begin(request);
    })
    .onAfterHandle({ as: 'global' }, ({ request }) => {
      tracker.end(request);
    })
    .onError({ as: 'global' }, ({ request }) => {
      tracker.end(request);
    });
}

export function createMetricsRoutes(tracker: MetricsTracker = serverMetrics) {
  return new Elysia({ prefix: '/api' }).get('/metrics', () => tracker.snapshot(), {
    response: MetricsResponseSchema,
    detail: {
      tags: ['metrics'],
      menu: { group: 'hidden' },
      description: 'Returns runtime process metrics for operations telemetry and diagnostics.',
      summary: 'Runtime process metrics',
    },
  });
}

export const metricsRoutes = createMetricsRoutes();
