/** GET /api/arra/topology — live hub topology for the hub UI's Topology tab (#3110). Owner only. */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { buildTopology } from '../../arra/topology.ts';
import { failed } from './guard.ts';

function portOf(request: Request): number | null {
  const fromUrl = Number(new URL(request.url).port);
  if (fromUrl) return fromUrl;
  const env = Number(process.env.ORACLE_PORT);
  return env || null;
}

export function createArraTopologyRoutes() {
  return new Elysia()
    .get('/topology', ({ request, set }) => {
      try { return buildTopology(sqlite, { port: portOf(request) }); }
      catch (error) { return failed(set, error); }
    }, { detail: { tags: ['arra'], summary: 'Hub topology: vault (truth), hub, nodes with state, door refusals, Ossie export status' } });
}
