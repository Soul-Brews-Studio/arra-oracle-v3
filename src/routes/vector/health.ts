/**
 * GET /api/vector/health — vector adapter liveness probe.
 *
 * Pings each registered embedding engine. Returns:
 *   - status: 'ok' | 'degraded' | 'down'
 *   - engines[]: per-engine ok/error
 *
 * Cheaper than /api/vector/stats (no count aggregation) — safe for
 * load-balancer health checks.
 */

import { Elysia } from 'elysia';
import { createVectorProxy, type VectorProxy } from '../../server/vector-proxy.ts';
import { resolveVectorUrl } from '../../config.ts';
import { getDetectedEmbeddingProviders } from '../../vector/provider-detection.ts';
import { attachVectorDashboardHealth, readVectorBackendHealth } from '../../vector/health.ts';

type VectorHealthResult = Awaited<ReturnType<typeof readVectorBackendHealth>>;

export interface VectorHealthEndpointOptions {
  vectorHealth?: () => Promise<VectorHealthResult>;
  detectProviders?: () => Promise<{ providers: Array<{ type: string; available: boolean; error?: string; detail?: string }> }>;
  proxy?: VectorProxy | null;
}

export function createVectorHealthEndpoint(options: VectorHealthEndpointOptions = {}) {
  const vectorHealth = options.vectorHealth ?? readVectorBackendHealth;
  const detectProviders = options.detectProviders ?? (() => getDetectedEmbeddingProviders(false));

  async function readHealth({ set }: { set: { status?: number | string } }) {
    const vectorUrl = resolveVectorUrl();
    const proxy = options.proxy === undefined ? createVectorProxy(vectorUrl) : options.proxy;
    if (proxy) {
      const ok = await proxy.available();
      if (ok) {
        const detected = await detectProviders().catch(() => ({ providers: [] }));
        return { ...attachVectorDashboardHealth({ status: 'ok' as const, engines: [], checked_at: new Date().toISOString() }, detected.providers), proxy: vectorUrl };
      }
      set.status = 503;
      const detected = await detectProviders().catch(() => ({ providers: [] }));
      return { ...attachVectorDashboardHealth({ status: 'down' as const, engines: [], checked_at: new Date().toISOString() }, detected.providers), proxy: vectorUrl };
    }
    try {
      const [result, detected] = await Promise.all([
        vectorHealth(),
        detectProviders().catch(() => ({ providers: [] })),
      ]);
      if (result.status === 'down') set.status = 503;
      return attachVectorDashboardHealth(result, detected.providers);
    } catch (e: any) {
      set.status = 500;
      return { error: e.message, status: 'down', engines: [], checked_at: new Date().toISOString() };
    }
  }

  return new Elysia()
    .get('/vector/health', readHealth, {
      detail: {
        tags: ['vector'],
        menu: { group: 'hidden' },
        summary: 'Vector adapter liveness check',
      },
    })
    .get('/vector/status', readHealth, {
      detail: {
        tags: ['vector'],
        menu: { group: 'hidden' },
        summary: 'Versioned vector adapter status alias',
      },
    });
}

export const vectorHealthEndpoint = createVectorHealthEndpoint();
