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
  lastResponseMs: number;
  maxResponseMs: number;
  activeConnections: number;
  errorCount: number;
  statusCounts: Record<string, number>;
  methodCounts: Record<string, number>;
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
  end(request: Request, statusCode?: number): void;
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
  lastResponseMs: t.Number(),
  maxResponseMs: t.Number(),
  activeConnections: t.Number(),
  errorCount: t.Number(),
  statusCounts: t.Record(t.String(), t.Number()),
  methodCounts: t.Record(t.String(), t.Number()),
  lastRestart: t.String(),
  memoryUsage: MemoryUsageSchema,
  tenant: t.Optional(t.Object({ id: t.String(), scope: t.Literal('tenant_id') })),
});

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function round(value: number): number {
  return Math.round(safeNumber(value) * 1000) / 1000;
}

function processMemoryUsage(): MemoryUsageSnapshot {
  const usage = process.memoryUsage();
  return sanitizeMemoryUsage({
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers ?? 0,
  });
}

function sanitizeMemoryUsage(snapshot: MemoryUsageSnapshot): MemoryUsageSnapshot {
  return {
    rss: safeNumber(snapshot.rss),
    heapTotal: safeNumber(snapshot.heapTotal),
    heapUsed: safeNumber(snapshot.heapUsed),
    external: safeNumber(snapshot.external),
    arrayBuffers: safeNumber(snapshot.arrayBuffers),
  };
}

type RequestStart = { startedAt: number; tenantId?: string; method: string };
type MetricsCounter = {
  requestCount: number;
  totalResponseMs: number;
  activeConnections: number;
  errorCount: number;
  lastResponseMs: number;
  maxResponseMs: number;
  statusCounts: Record<string, number>;
  methodCounts: Record<string, number>;
};

function counter(): MetricsCounter {
  return {
    requestCount: 0,
    totalResponseMs: 0,
    activeConnections: 0,
    errorCount: 0,
    lastResponseMs: 0,
    maxResponseMs: 0,
    statusCounts: { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, unknown: 0 },
    methodCounts: {},
  };
}

function safeMemoryUsage(readMemoryUsage: () => MemoryUsageSnapshot): MemoryUsageSnapshot {
  try {
    return sanitizeMemoryUsage(readMemoryUsage());
  } catch {
    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  }
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

function endCounter(metrics: MetricsCounter, elapsedMs: number, statusCode: number | undefined, method: string): void {
  const elapsed = safeNumber(elapsedMs);
  const bucket = statusBucket(statusCode);
  metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
  metrics.requestCount += 1;
  metrics.totalResponseMs += elapsed;
  metrics.lastResponseMs = round(elapsed);
  metrics.maxResponseMs = Math.max(metrics.maxResponseMs, metrics.lastResponseMs);
  metrics.statusCounts[bucket] = (metrics.statusCounts[bucket] ?? 0) + 1;
  metrics.methodCounts[method] = (metrics.methodCounts[method] ?? 0) + 1;
  if (bucket === '5xx') metrics.errorCount += 1;
}

function readNow(nowMs: () => number): number {
  try { return safeNumber(nowMs()); } catch { return 0; }
}

function isoFromMs(ms: number): string {
  try { return new Date(safeNumber(ms)).toISOString(); }
  catch { return new Date(0).toISOString(); }
}

function statusBucket(statusCode: number | undefined): string {
  if (!Number.isFinite(statusCode)) return 'unknown';
  const bucket = Math.trunc(Number(statusCode) / 100);
  return bucket >= 1 && bucket <= 5 ? `${bucket}xx` : 'unknown';
}

function statusFrom(response: unknown, setStatus: unknown, fallback: number): number {
  if (response instanceof Response) return response.status;
  if (typeof setStatus === 'number') return setStatus;
  return fallback;
}

export function createMetricsTracker(options: MetricsTrackerOptions = {}): MetricsTracker {
  const nowMs = options.nowMs ?? (() => Date.now());
  const startedAtMs = safeNumber(options.startedAtMs ?? readNow(nowMs));
  const lastRestart = options.lastRestart ?? isoFromMs(startedAtMs);
  const memoryUsage = options.memoryUsage ?? processMemoryUsage;
  const starts = new WeakMap<Request, RequestStart>();
  const globalCounter = counter();
  const tenantCounters = new Map<string, MetricsCounter>();

  const buildSnapshot = (metrics: MetricsCounter, tenantId?: string): MetricsSnapshot => ({
    uptime: round((readNow(nowMs) - startedAtMs) / 1000),
    requestCount: metrics.requestCount,
    avgResponseMs: metrics.requestCount === 0 ? 0 : round(metrics.totalResponseMs / metrics.requestCount),
    lastResponseMs: metrics.lastResponseMs,
    maxResponseMs: metrics.maxResponseMs,
    activeConnections: metrics.activeConnections,
    errorCount: metrics.errorCount,
    statusCounts: { ...metrics.statusCounts },
    methodCounts: { ...metrics.methodCounts },
    lastRestart,
    memoryUsage: safeMemoryUsage(memoryUsage),
    tenant: tenantId ? { id: tenantId, scope: 'tenant_id' } : undefined,
  });

  return {
    begin(request) {
      if (starts.has(request)) return;
      const tenantId = currentTenantId();
      starts.set(request, { startedAt: readNow(nowMs), tenantId, method: request.method.toUpperCase() });
      beginCounter(globalCounter);
      if (tenantId) beginCounter(tenantCounter(tenantCounters, tenantId));
    },
    end(request, statusCode) {
      const started = starts.get(request);
      if (started === undefined) return;
      starts.delete(request);
      const elapsed = readNow(nowMs) - started.startedAt;
      endCounter(globalCounter, elapsed, statusCode, started.method);
      if (started.tenantId) {
        endCounter(tenantCounter(tenantCounters, started.tenantId), elapsed, statusCode, started.method);
      }
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
    .onAfterHandle({ as: 'global' }, (ctx) => {
      tracker.end(ctx.request, statusFrom((ctx as any).response, (ctx as any).set?.status, 200));
    })
    .onError({ as: 'global' }, (ctx) => {
      tracker.end(ctx.request, statusFrom(undefined, (ctx as any).set?.status, 500));
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
