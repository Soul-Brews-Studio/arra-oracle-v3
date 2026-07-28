/**
 * Vector Routes (Elysia) — composes the vector-only HTTP surface.
 *
 * Endpoints:
 *   GET /api/similar         — nearest-neighbor by doc id
 *   GET /api/compare         — fan-out search across embedding models
 *   GET /api/map             — 2D layout of all docs
 *   GET /api/map3d           — 3D PCA projection from real embeddings
 *   GET /api/vector/stats    — per-engine collection counts
 *   GET /api/vector/health   — adapter liveness probe
 *
 * Mounted with the `/api` prefix from server.ts. Phase 1 of #1071: separating
 * the vector layer from FTS/hybrid so it can later move behind VECTOR_URL.
 */

import { Elysia } from 'elysia';
import { similarEndpoint } from './similar.ts';
import { compareEndpoint } from './compare.ts';
import { mapEndpoint } from './map.ts';
import { map3dEndpoint } from './map3d.ts';
import { vectorStatsEndpoint } from './stats.ts';
import { vectorHealthEndpoint } from './health.ts';
import { vectorConfigEndpoint } from './config.ts';
import { vectorIndexerEndpoints } from './indexer.ts';

export const vectorRoutes = new Elysia({ prefix: '/api' })
  .use(similarEndpoint)
  .use(compareEndpoint)
  .use(mapEndpoint)
  .use(map3dEndpoint)
  .use(vectorStatsEndpoint)
  .use(vectorHealthEndpoint)
  .use(vectorConfigEndpoint)
  .use(vectorIndexerEndpoints);
