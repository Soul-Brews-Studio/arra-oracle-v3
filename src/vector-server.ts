/**
 * Arra Vector Server — standalone Elysia sidecar.
 *
 * Phase 3 of #1071: runs as a separate process so the vector layer
 * can scale independently of the main Oracle HTTP server.
 *
 * Usage:
 *   ORACLE_VECTOR_READONLY=1 bun src/vector-server.ts
 *
 * The main server proxies to this via VECTOR_URL=http://localhost:<port>.
 * Opens oracle.db in READ-ONLY mode (no WAL contention).
 */

import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';

import { createCorsMiddleware } from './middleware/cors.ts';
import { loadVectorConfig, generateDefaultConfig, configToModels } from './vector/config.ts';
import type { VectorServerConfig, VectorModelRegistryEntry } from './vector/config-types.ts';
import type { VectorStoreAdapter } from './vector/adapter.ts';
import { warmEmbeddingProviderDetection } from './vector/provider-detection.ts';
import { vectorRoutes } from './routes/vector/index.ts';
import { createVectorProxyServer } from './vector/proxy-server.ts';
import { createVectorStoreForModel } from './vector/factory.ts';
import { searchEndpoint } from './routes/search/search.ts';

import pkg from '../package.json' with { type: 'json' };

// ── Config ──────────────────────────────────────────────────────────
const config = loadVectorConfig() ?? generateDefaultConfig();
const PORT = Number(process.env.VECTOR_PORT ?? config.port);
void warmEmbeddingProviderDetection().catch((error) =>
  console.warn('[Vector] embedding provider auto-detect failed:', error instanceof Error ? error.message : String(error)));

/**
 * Which collection this sidecar should actually serve. createVectorProxyServer()
 * defaults to a hardcoded legacy collection name when given no store/collectionName
 * — this picks the config's own `primary: true` entry (or the first configured one)
 * instead, so the sidecar opens the SAME collection/model the main server's
 * getEmbeddingModels()-driven paths already resolve to (config.ts:configToModels).
 * Without this, the sidecar silently opened an old, differently-embedded
 * collection — a persisted-vs-current embedder dimension mismatch that made every
 * default search hang against the sidecar until it timed out (ORA-SHARED-20260820-06).
 */
export function resolvePrimaryVectorModel(
  cfg: VectorServerConfig,
): { key: string; entry: VectorModelRegistryEntry } | null {
  const models = configToModels(cfg);
  const keys = Object.keys(models);
  if (keys.length === 0) return null;
  const primaryKey = Object.entries(cfg.collections).find(([, col]) => col.primary === true)?.[0];
  const key = primaryKey && models[primaryKey] ? primaryKey : keys[0];
  return { key, entry: models[key] };
}

function proxyServerOptions(
  cfg: VectorServerConfig,
  version: string,
  storeFactory: (entry: VectorModelRegistryEntry) => VectorStoreAdapter,
) {
  const primary = resolvePrimaryVectorModel(cfg);
  if (!primary) return { version };
  return {
    version,
    collectionName: primary.entry.collection,
    store: storeFactory(primary.entry),
  };
}

// ── App ─────────────────────────────────────────────────────────────
// cfg/storeFactory default to the real module-level config and the real
// LanceDB/Qdrant/etc. store builder — production calls createVectorServerApp()
// with no args and gets exactly that. Tests inject a fake config + a fake
// store factory so they drive the SAME wiring line production runs, instead
// of constructing their own parallel proxy server (a prior test in this file
// did that and stayed green through a mutation-tested revert of this wiring —
// Riddler catch, ORA-SHARED-20260820-06 delta).
export function createVectorServerApp(
  cfg: VectorServerConfig = config,
  storeFactory: (entry: VectorModelRegistryEntry) => VectorStoreAdapter = createVectorStoreForModel,
) {
  return new Elysia()
    .use(createCorsMiddleware())
    .use(
      swagger({
        path: '/swagger',
        documentation: {
          info: {
            title: 'Arra Vector Server',
            version: pkg.version,
            description: 'Standalone vector / embedding sidecar for Arra Oracle.',
          },
        },
      }),
    )
    .get('/', () => ({
      server: 'arra-vector',
      version: pkg.version,
      status: 'ok',
      docs: '/swagger',
    }))
    .use(createVectorProxyServer(proxyServerOptions(cfg, pkg.version, storeFactory)))
    .use(new Elysia({ prefix: '/api' }).use(searchEndpoint))
    .use(vectorRoutes);
}

const app = createVectorServerApp();

console.log(`
🧭 Arra Vector Server running! (Elysia)

   URL:     http://localhost:${PORT}
   Swagger: http://localhost:${PORT}/swagger
   Version: ${pkg.version}
   DB mode: ${process.env.ORACLE_VECTOR_READONLY === '1' ? 'readonly' : 'read-write'}
`);

export default {
  port: PORT,
  fetch: app.fetch,
};
