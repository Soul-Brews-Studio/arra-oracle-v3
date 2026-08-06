/**
 * The ten schema-bearing route declarations covered by #2821 step 1.
 *
 * Each case can be mounted twice from the SAME factory: once bare (no envelope
 * middleware) and once wrapped (real createResponseFormatMiddleware). "Neutral"
 * is defined as: both mounts return byte-identical JSON. That definition is
 * self-calibrating — it needs no hardcoded key lists to rot.
 */
import { Elysia } from 'elysia';
import { createResponseFormatMiddleware } from '../../../src/middleware/response-format.ts';
import { createDeepHealthEndpoint } from '../../../src/routes/health/deep.ts';
import { createStatsEndpoint } from '../../../src/routes/health/stats.ts';
import { createOraclesEndpoint } from '../../../src/routes/health/oracles.ts';
import { createThorOracleEndpoint } from '../../../src/routes/health/thor.ts';
import { createOracleProfilesEndpoint } from '../../../src/routes/profile/index.ts';
import { createMenuEndpoint } from '../../../src/routes/menu/menu.ts';
import { createCustomMenuRoutes } from '../../../src/routes/menu/custom.ts';
import { createMetricsRoutes, createMetricsTracker } from '../../../src/routes/metrics/metrics.ts';

export type AppLike = { handle(request: Request): Response | Promise<Response> };

export type EnvelopeCase = {
  /** Source declaration this case guards, as file:line. */
  where: string;
  method: string;
  path: string;
  build: () => unknown;
  /** True when the factory already carries its own `/api` prefix. */
  selfPrefixed?: boolean;
};

const fixedMemory = { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 };

const deepOptions = {
  dbPing: () => ({ status: 'connected' as const }),
  vectorHealth: async () => ({ status: 'ok' as const, checked_at: 'fixed', engines: [] }),
  diskUsage: () => ({
    status: 'ok' as const,
    path: '/tmp/oracle-envelope',
    totalBytes: 100,
    freeBytes: 50,
    usedBytes: 50,
    usedPercent: 50,
  }),
  memoryUsage: () => fixedMemory,
};

const statsOptions = {
  vectorStats: async () => ({
    vector: { enabled: true, count: 0, collection: 'oracle_knowledge' },
    vectors: [],
  }),
  embedderRuntime: async () => ({
    status: 'ok' as const,
    provider: 'ollama',
    source: 'auto-default',
    explicit: false,
    checkedAt: 'fixed',
  }),
};

function fixedTracker() {
  return createMetricsTracker({
    startedAtMs: 0,
    lastRestart: '2026-06-16T00:00:00.000Z',
    nowMs: () => 1_000,
    memoryUsage: () => fixedMemory,
  });
}

export const envelopeCases: EnvelopeCase[] = [
  { where: 'health/thor.ts:7', method: 'GET', path: '/api/oracles/thor', build: () => createThorOracleEndpoint() },
  { where: 'health/stats.ts:100', method: 'GET', path: '/api/stats', build: () => createStatsEndpoint(statsOptions) },
  { where: 'health/deep.ts:135', method: 'GET', path: '/api/health/deep', build: () => createDeepHealthEndpoint(deepOptions) },
  { where: 'health/oracles.ts:118', method: 'GET', path: '/api/oracles', build: () => createOraclesEndpoint() },
  { where: 'profile/index.ts:54', method: 'GET', path: '/api/oracles/profiles', build: () => createOracleProfilesEndpoint() },
  { where: 'profile/index.ts:67', method: 'GET', path: '/api/oracles/profiles/thor', build: () => createOracleProfilesEndpoint() },
  { where: 'menu/menu.ts:37', method: 'GET', path: '/api/menu/source', build: () => createMenuEndpoint() },
  { where: 'menu/menu.ts:51', method: 'POST', path: '/api/menu/reload', build: () => createMenuEndpoint() },
  { where: 'menu/custom.ts:37', method: 'GET', path: '/api/menu/custom', build: () => createCustomMenuRoutes() },
  { where: 'metrics.ts:237', method: 'GET', path: '/api/metrics', build: () => createMetricsRoutes(fixedTracker()), selfPrefixed: true },
];

function compose(instance: EnvelopeCase): Elysia {
  const sub = instance.build() as Elysia;
  return instance.selfPrefixed ? sub : (new Elysia({ prefix: '/api' }).use(sub) as Elysia);
}

/** Route as it behaves with no envelope middleware at all — the reference bytes. */
export function mountBare(instance: EnvelopeCase): AppLike {
  return compose(instance);
}

/** Route under the real, unmodified response-format middleware (today's production path). */
export function mountWrapped(instance: EnvelopeCase): AppLike {
  return new Elysia().use(createResponseFormatMiddleware()).use(compose(instance)) as AppLike;
}

/**
 * Step 2 preview: response-format.ts:41 with the `...response` spread removed.
 * Declared here so the preview never edits the real middleware (that is step 2).
 */
export function mountNoSpread(instance: EnvelopeCase): AppLike {
  const preview = new Elysia({ name: 'no-spread-preview' })
    .onAfterHandle({ as: 'global' }, ({ response, set }) => {
      if (response === undefined || response instanceof Response) return;
      if (typeof response === 'string' || response instanceof Uint8Array) return;
      const status = (set as { status?: unknown }).status;
      const code = typeof status === 'number' ? status : 200;
      const success = code < 400;
      const payload = response as Record<string, unknown>;
      if (typeof payload?.success === 'boolean') return payload;
      if (!success || typeof payload?.error === 'string') {
        const error = typeof payload?.error === 'string' ? payload.error : 'Request failed';
        return { success: false, error };
      }
      return { success: true, data: response };
    });
  return new Elysia().use(preview).use(compose(instance)) as AppLike;
}

const VOLATILE = new Set(['checked_at', 'cached_at', 'latencyMs', 'loaded_at']);

/** Blank the non-deterministic fields so two mounts can be compared exactly. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = VOLATILE.has(key) ? '<volatile>' : normalize(inner);
    }
    return out;
  }
  return value;
}

export type Read = { status: number; text: string; body: unknown; parsed: boolean };

/**
 * Never throws on a non-JSON body. `/api/stats` and `/api/oracles` query SQLite
 * directly and answer `500 "disk I/O error"` when the whole 1200-file suite
 * contends on the shared DB file. That is environmental, so the caller decides
 * what to assert — the bare-vs-wrapped comparison stays valid at any status.
 */
export async function readJson(app: AppLike, instance: EnvelopeCase): Promise<Read> {
  const res = await app.handle(new Request(`http://local${instance.path}`, { method: instance.method }));
  const text = await res.text();
  if (!text) return { status: res.status, text, body: null, parsed: false };
  try {
    return { status: res.status, text, body: JSON.parse(text), parsed: true };
  } catch {
    return { status: res.status, text, body: null, parsed: false };
  }
}

/** True when the environment actually served the route, so 200-shape claims apply. */
export function served(read: Read): boolean {
  return read.status === 200 && read.parsed;
}
