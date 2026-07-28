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
import { handleVectorHealth } from '../../server/vector-handlers.ts';
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { VECTOR_URL } from '../../config.ts';

const proxy = createVectorProxy(VECTOR_URL);

export const vectorHealthEndpoint = new Elysia().get(
  '/vector/health',
  async ({ set }) => {
    if (proxy) {
      const ok = await proxy.available();
      if (ok) {
        return { status: 'ok' as const, engines: [], checked_at: new Date().toISOString(), proxy: VECTOR_URL };
      }
      set.status = 503;
      return { status: 'down' as const, engines: [], checked_at: new Date().toISOString(), proxy: VECTOR_URL };
    }
    try {
      const result = await handleVectorHealth();
      if (result.status === 'down') set.status = 503;
      return result;
    } catch (e: any) {
      set.status = 500;
      return { error: e.message, status: 'down', engines: [], checked_at: new Date().toISOString() };
    }
  },
  {
    detail: {
      tags: ['vector'],
      menu: { group: 'hidden' },
      summary: 'Vector adapter liveness check',
    },
  },
);
