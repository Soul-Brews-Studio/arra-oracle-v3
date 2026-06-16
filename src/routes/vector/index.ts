/**
 * Vector Routes (Elysia) — composes the vector-only HTTP surface.
 *
 * Endpoints:
 *   GET /api/vector/search  — vector-mode search alias
 *   GET /api/vector/fanout  — fan-out query across configured vector backends
 *   GET /api/similar         — nearest-neighbor by doc id
 *   GET /api/compare         — fan-out search across embedding models
 *   GET /api/map             — 2D layout of all docs
 *   GET /api/map3d           — 3D PCA projection from real embeddings
 *   GET /api/vector/stats    — per-engine collection counts
 *   GET /api/vector/health   — adapter liveness probe
 *   GET /api/vector/cost-estimate — estimate remote embedding cost
 *   GET /api/vector/costs    — embedding provider usage costs
 *   POST /api/vector/costs/usage — record provider usage for live cost tracking
 *   GET /api/vector/documents — browse indexed vector documents
 *   GET /api/vector/providers — detected embedding providers and capabilities
 *   POST /api/vector/providers/test — probe one embedding provider config
 *   GET /api/v1/vector/export/formats — available export formats
 *   GET /api/v1/vector/export — stream vector docs in a registered format
 * Mounted with the `/api` prefix from server.ts. Phase 1 of #1071: separating
 * the vector layer from FTS/hybrid so it can later move behind VECTOR_URL.
 */

import { Elysia } from 'elysia';
import { vectorSearchEndpoint } from './search.ts';
import { fanoutEndpoint } from './fanout.ts';
import { similarEndpoint } from './similar.ts';
import { compareEndpoint } from './compare.ts';
import { mapEndpoint } from './map.ts';
import { map3dEndpoint } from './map3d.ts';
import { vectorStatsEndpoint } from './stats.ts';
import { vectorHealthEndpoint } from './health.ts';
import { vectorIndexerEndpoints } from './indexer.ts';
import { vectorProxyEndpoint } from './proxy.ts';
import { vectorDocumentsEndpoint } from './documents.ts';
import { vectorExportEndpoint } from './export.ts';
import { vectorServicesApiEndpoint } from './services.ts';
import { vectorProvidersEndpoint } from './providers.ts';
import { vectorCostEndpoint } from './cost.ts';
import { vectorCostsEndpoint } from './costs.ts';
import { vectorConfigApiEndpoint } from './config.ts';
import { vectorCollectionsEndpoint } from './collections.ts';

export const vectorRoutes = new Elysia({ prefix: '/api' })
  .use(vectorProxyEndpoint)
  .use(vectorSearchEndpoint)
  .use(fanoutEndpoint)
  .use(similarEndpoint)
  .use(compareEndpoint)
  .use(mapEndpoint)
  .use(map3dEndpoint)
  .use(vectorStatsEndpoint)
  .use(vectorHealthEndpoint)
  .use(vectorDocumentsEndpoint)
  .use(vectorExportEndpoint)
  .use(vectorProvidersEndpoint)
  .use(vectorCostEndpoint)
  .use(vectorCostsEndpoint)
  .use(vectorConfigApiEndpoint)
  .use(vectorCollectionsEndpoint)
  .use(vectorServicesApiEndpoint)
  .use(vectorIndexerEndpoints);
