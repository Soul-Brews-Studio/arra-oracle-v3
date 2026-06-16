/**
 * Vector Routes (Elysia) — composes the vector-only HTTP surface.
 *
 * Endpoints:
 *   GET /api/vector/search  — vector-mode search alias
 *   GET /api/similar         — nearest-neighbor by doc id
 *   GET /api/compare         — fan-out search across embedding models
 *   GET /api/map             — 2D layout of all docs
 *   GET /api/map3d           — 3D PCA projection from real embeddings
 *   GET /api/vector/stats    — per-engine collection counts
 *   GET /api/vector/health   — adapter liveness probe
 *   GET /api/vector/documents — browse indexed vector documents
 *   GET /api/v1/vector/export/formats — available export formats
 *   GET /api/v1/vector/export — stream vector docs in a registered format
 *   GET /api/v1/vector/config — config + per-collection health/counts
 *   PUT /api/v1/vector/config/:collection — update collection adapter/model/provider
 *   POST /api/v1/vector/config/reload — clear cached vector stores
 *   POST /api/v1/vector/config/:collection/test — probe one collection
 *
 * Mounted with the `/api` prefix from server.ts. Phase 1 of #1071: separating
 * the vector layer from FTS/hybrid so it can later move behind VECTOR_URL.
 */

import { Elysia } from 'elysia';
import { vectorSearchEndpoint } from './search.ts';
import { similarEndpoint } from './similar.ts';
import { compareEndpoint } from './compare.ts';
import { mapEndpoint } from './map.ts';
import { map3dEndpoint } from './map3d.ts';
import { vectorStatsEndpoint } from './stats.ts';
import { vectorHealthEndpoint } from './health.ts';
import { vectorConfigApiEndpoint } from './config-api.ts';
import { vectorIndexerEndpoints } from './indexer.ts';
import { vectorProxyEndpoint } from './proxy.ts';
import { vectorDocumentsEndpoint } from './documents.ts';
import { vectorExportEndpoint } from './export.ts';
import { vectorServicesApiEndpoint } from './services.ts';

export const vectorRoutes = new Elysia({ prefix: '/api' })
  .use(vectorProxyEndpoint)
  .use(vectorSearchEndpoint)
  .use(similarEndpoint)
  .use(compareEndpoint)
  .use(mapEndpoint)
  .use(map3dEndpoint)
  .use(vectorStatsEndpoint)
  .use(vectorHealthEndpoint)
  .use(vectorDocumentsEndpoint)
  .use(vectorExportEndpoint)
  .use(vectorConfigApiEndpoint)
  .use(vectorServicesApiEndpoint)
  .use(vectorIndexerEndpoints);
