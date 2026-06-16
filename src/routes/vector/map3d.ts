/**
 * GET /api/map3d — real PCA from LanceDB bge-m3 embeddings.
 *
 * When VECTOR_URL is set, proxies to the remote vector server.
 * Falls back to local handleMap3d() when proxy is unavailable or unset.
 */

import { Elysia } from 'elysia';
import { handleMap3d } from '../../server/vector-handlers.ts';
import { createVectorProxy } from '../../server/vector-proxy.ts';
import { resolveVectorUrl } from '../../config.ts';
import { Map3dQuery } from './model.ts';

const currentProxy = () => createVectorProxy(resolveVectorUrl());

export const map3dEndpoint = new Elysia().get(
  '/map3d',
  async ({ query, set }) => {
    const model = query.model || undefined;

    // VECTOR_URL set -> proxy first, fall back to local on failure.
    const proxy = currentProxy();
    if (proxy) {
      const remote = await proxy.map3d(model);
      if (remote) return remote;
      set.status = 503;
      return { error: 'Vector proxy unavailable', documents: [], total: 0 };
    }

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
      summary: '3D PCA projection of embeddings',
    },
  },
);
