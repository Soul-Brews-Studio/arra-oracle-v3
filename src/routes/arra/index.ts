/**
 * /api/arra/* — the owner's own arra: status, vault share/sync, snapshots, grouped search,
 * hubs joined, retire. Loopback only (see guard.ts). The CLI, MCP tools and skills all call
 * these routes, so the four doors always agree (#3110).
 */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { buildStatus } from '../../arra/status.ts';
import { denied, failed, isOwnerRequest } from './guard.ts';
import { createArraVaultRoutes, shareNote, snapshotAction, syncAll } from './vault.ts';
import { createArraSearchRoutes, readDoc, searchAction } from './search.ts';

export function createArraRoutes() {
  return new Elysia({ prefix: '/api/arra' })
    .onBeforeHandle(({ request, set }) => {
      if (!isOwnerRequest(request)) return denied(set, 403, '/api/arra is for this machine only; remote nodes use /api/federation');
    })
    .get('/status', () => buildStatus(sqlite), {
      detail: { tags: ['arra'], summary: 'This arra: data dir, docs per source, vaults, hubs, embedder, snapshots' },
    })
    .use(createArraVaultRoutes())
    .use(createArraSearchRoutes())
    // One entry point for the MCP arra_vault tool: { action, ...args } → the routes above.
    .post('/vault', async ({ body, set }) => {
      const { action, ...args } = (body ?? {}) as Record<string, any>;
      try {
        if (action === 'share') return shareNote(args);
        if (action === 'sync') return await syncAll(args.vault);
        if (action === 'search') return await searchAction(String(args.q ?? args.query ?? ''), args.limit);
        if (action === 'read') return await readDoc(String(args.id ?? ''));
        if (typeof action === 'string' && action.startsWith('snapshot_')) {
          const result = await snapshotAction(action.slice('snapshot_'.length), args);
          if (result.ok === false) set.status = 409;
          return result;
        }
        return failed(set, `unknown arra_vault action: ${action}`);
      } catch (error) { return failed(set, error); }
    }, { detail: { tags: ['arra'], summary: 'MCP arra_vault dispatch: share, sync, search, read, snapshot_*' } });
}

export const arraRoutes = createArraRoutes();
