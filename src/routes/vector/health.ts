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
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { VECTOR_URL } from '../../config.ts';
import { readVectorBackendHealth } from '../../vector/health.ts';

const defaultProxy = createVectorProxy(VECTOR_URL);

type VectorHealthResult = Awaited<ReturnType<typeof readVectorBackendHealth>>;

export interface VectorHealthEndpointOptions {
  vectorHealth?: () => Promise<VectorHealthResult>;
  proxy?: typeof defaultProxy;
}

export function createVectorHealthEndpoint(options: VectorHealthEndpointOptions = {}) {
  const proxy = options.proxy === undefined ? defaultProxy : options.proxy;
  const vectorHealth = options.vectorHealth ?? readVectorBackendHealth;

  async function readHealth({ set }: { set: { status?: number | string } }) {
    if (proxy) {
      const ok = await proxy.available();
      if (ok) {
        return { status: 'ok' as const, engines: [], checked_at: new Date().toISOString(), proxy: VECTOR_URL };
      }
      set.status = 503;
      return { status: 'down' as const, engines: [], checked_at: new Date().toISOString(), proxy: VECTOR_URL };
    }
    try {
      const result = await vectorHealth();
      if (result.status === 'down') set.status = 503;
      return result;
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
