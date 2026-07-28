/**
 * GET /api/vector/stats — per-engine vector collection counts.
 *
 * Same payload that /api/stats embeds under `vector` / `vectors`, but exposed
 * directly so frontends can poll the vector layer without the SQLite stats hit.
 */

import { Elysia } from 'elysia';
import { handleVectorStats } from '../../server/vector-handlers.ts';
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { VECTOR_URL } from '../../config.ts';

const proxy = createVectorProxy(VECTOR_URL);

export const vectorStatsEndpoint = new Elysia().get(
  '/vector/stats',
  async ({ set }) => {
    if (proxy) {
      const remote = await proxy.stats();
      if (remote) return remote;
      set.status = 503;
      return { error: 'Vector proxy unavailable' };
    }
    try {
      return await handleVectorStats();
    } catch (e: any) {
      set.status = 500;
      return { error: e.message };
    }
  },
  {
    detail: {
      tags: ['vector'],
      menu: { group: 'tools', order: 55 },
      summary: 'Vector engine stats (per-model collection counts)',
    },
  },
);
