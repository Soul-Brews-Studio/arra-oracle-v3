/**
 * GET /api/map — 2D projection of all embeddings.
 *
 * When VECTOR_URL is set, proxies to the remote vector server.
 * Falls back to local handleMap() when proxy is unavailable or unset.
 */

import { Elysia } from 'elysia';
import { handleMap } from '../../server/vector-handlers.ts';
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { resolveVectorUrl } from '../../config.ts';

const currentProxy = () => createVectorProxy(resolveVectorUrl());

export const mapEndpoint = new Elysia().get('/map', async ({ set }) => {
  // VECTOR_URL set -> proxy first, fall back to local on failure.
  const proxy = currentProxy();
  if (proxy) {
    const remote = await proxy.map();
    if (remote) return remote;
    set.status = 503;
    return { error: 'Vector proxy unavailable', documents: [], total: 0 };
  }

  try {
    return await handleMap();
  } catch (e: any) {
    set.status = 500;
    return { error: e.message, documents: [], total: 0 };
  }
}, {
  detail: {
    tags: ['vector'],
    menu: { group: 'tools', path: '/map', order: 20 },
    summary: '2D projection of embeddings',
  },
});
