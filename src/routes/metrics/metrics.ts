import { Elysia } from 'elysia';

export interface MetricsSnapshot {
  uptime: number;
  requestCount: number;
  avgResponseMs: number;
  activeConnections: number;
  lastRestart: string;
}

export interface MetricsTrackerOptions {
  startedAtMs?: number;
  nowMs?: () => number;
  lastRestart?: string;
}

export interface MetricsTracker {
  begin(request: Request): void;
  end(request: Request): void;
  snapshot(): MetricsSnapshot;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function createMetricsTracker(options: MetricsTrackerOptions = {}): MetricsTracker {
  const nowMs = options.nowMs ?? (() => Date.now());
  const startedAtMs = options.startedAtMs ?? nowMs();
  const lastRestart = options.lastRestart ?? new Date(startedAtMs).toISOString();
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
    detail: {
      tags: ['metrics'],
      menu: { group: 'hidden' },
      summary: 'Runtime process metrics',
    },
  });
}

export const metricsRoutes = createMetricsRoutes();
