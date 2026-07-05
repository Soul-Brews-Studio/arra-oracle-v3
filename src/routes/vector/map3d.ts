/**
 * GET /api/map3d — DB/FTS-backed 3D document globe.
 *
 * This endpoint intentionally stays local even when VECTOR_URL is set so the
 * memory map reflects the full SQLite/FTS corpus, not a partial vector index.
 */

import { Elysia } from 'elysia';
import { handleMap3d } from '../../server/vector-handlers.ts';
import { Map3dQuery } from './model.ts';

export const map3dEndpoint = new Elysia().get(
  '/map3d',
  async ({ query, set }) => {
    const model = query.model || undefined;

    try {
      return await handleMap3d(model);
    } catch (e: any) {
      set.status = 500;
      return { error: e.message, documents: [], total: 0 };
    }
  },
  {
    query: Map3dQuery,
    detail: {
      tags: ['vector'],
      menu: { group: 'tools', order: 30 },
      summary: '3D DB/FTS-backed document globe',
    },
  },
);
