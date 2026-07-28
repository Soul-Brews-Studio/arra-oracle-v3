/**
 * GET /api/similar — vector nearest-neighbor lookup for a given doc id.
 */

import { Elysia } from 'elysia';
import { handleSimilar } from '../../server/vector-handlers.ts';
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { VECTOR_URL } from '../../config.ts';
import { SimilarQuery } from './model.ts';

const proxy = createVectorProxy(VECTOR_URL);

export const similarEndpoint = new Elysia().get(
  '/similar',
  async ({ query, set }) => {
    const id = query.id;
    if (!id) {
      set.status = 400;
      return { error: 'Missing query parameter: id' };
    }
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '5')));
    const model = query.model;

    // VECTOR_URL set → proxy. On failure, fall through to 503.
    if (proxy) {
      const remote = await proxy.similar(id, limit, model);
      if (remote) return remote;
      set.status = 503;
      return { error: 'Vector proxy unavailable', results: [], docId: id };
    }

    try {
      return await handleSimilar(id, limit, model);
    } catch (e: any) {
      set.status = 404;
      return { error: e.message, results: [], docId: id };
    }
  },
  {
    query: SimilarQuery,
    detail: {
      tags: ['vector'],
      menu: { group: 'hidden' },
      summary: 'Vector nearest-neighbor lookup by doc id',
    },
  },
);
