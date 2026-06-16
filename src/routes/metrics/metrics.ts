import { Elysia, t } from 'elysia';
import { currentTenantId } from '../../middleware/tenant.ts';

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
  tenant?: { id: string; scope: 'tenant_id' };
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
  snapshot(tenantId?: string): MetricsSnapshot;
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
  tenant: t.Optional(t.Object({ id: t.String(), scope: t.Literal('tenant_id') })),
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

type MetricsCounter = { requestCount: number; totalResponseMs: number; activeConnections: number };
type RequestStart = { startedAt: number; tenantId?: string };

function counter(): MetricsCounter {
  return { requestCount: 0, totalResponseMs: 0, activeConnections: 0 };
}

function tenantCounter(counters: Map<string, MetricsCounter>, tenantId: string): MetricsCounter {
  const existing = counters.get(tenantId);
  if (existing) return existing;
  const created = counter();
  counters.set(tenantId, created);
  return created;
}

function beginCounter(metrics: MetricsCounter): void {
  metrics.activeConnections += 1;
}

function endCounter(metrics: MetricsCounter, elapsedMs: number): void {
  metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
  metrics.requestCount += 1;
  metrics.totalResponseMs += Math.max(0, elapsedMs);
}

export function createMetricsTracker(options: MetricsTrackerOptions = {}): MetricsTracker {
  const nowMs = options.nowMs ?? (() => Date.now());
  const startedAtMs = options.startedAtMs ?? nowMs();
  const lastRestart = options.lastRestart ?? new Date(startedAtMs).toISOString();
  const memoryUsage = options.memoryUsage ?? processMemoryUsage;
  const starts = new WeakMap<Request, RequestStart>();
  const globalCounter = counter();
  const tenantCounters = new Map<string, MetricsCounter>();

  const buildSnapshot = (metrics: MetricsCounter, tenantId?: string): MetricsSnapshot => ({
    uptime: round((nowMs() - startedAtMs) / 1000),
    requestCount: metrics.requestCount,
    avgResponseMs: metrics.requestCount === 0 ? 0 : round(metrics.totalResponseMs / metrics.requestCount),
    activeConnections: metrics.activeConnections,
    lastRestart,
    memoryUsage: memoryUsage(),
    tenant: tenantId ? { id: tenantId, scope: 'tenant_id' } : undefined,
  });

  return {
    begin(request) {
      const tenantId = currentTenantId();
      starts.set(request, { startedAt: nowMs(), tenantId });
      beginCounter(globalCounter);
      if (tenantId) beginCounter(tenantCounter(tenantCounters, tenantId));
    },
    end(request) {
      const started = starts.get(request);
      if (started === undefined) return;
      starts.delete(request);
      const elapsed = nowMs() - started.startedAt;
      endCounter(globalCounter, elapsed);
      if (started.tenantId) endCounter(tenantCounter(tenantCounters, started.tenantId), elapsed);
    },
    snapshot(tenantId = currentTenantId()) {
      if (!tenantId) return buildSnapshot(globalCounter);
      return buildSnapshot(tenantCounter(tenantCounters, tenantId), tenantId);
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
