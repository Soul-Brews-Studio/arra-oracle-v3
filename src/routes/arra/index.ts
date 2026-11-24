/**
 * /api/arra/* — the owner's own arra: status, vault share/sync, snapshots, grouped search,
 * hubs joined, retire. Loopback only (see guard.ts). The CLI, MCP tools and skills all call
 * these routes, so the four doors always agree (#3110).
 */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { buildStatus } from '../../arra/status.ts';
import { denied, isOwnerRequest } from './guard.ts';

export function createArraRoutes() {
  return new Elysia({ prefix: '/api/arra' })
    .onBeforeHandle(({ request, set }) => {
      if (!isOwnerRequest(request)) return denied(set, 403, '/api/arra is for this machine only; remote nodes use /api/federation');
    })
    .get('/status', () => buildStatus(sqlite), {
      detail: { tags: ['arra'], summary: 'This arra: data dir, docs per source, vaults, hubs, embedder, snapshots' },
    });
}

export const arraRoutes = createArraRoutes();
