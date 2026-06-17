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
import { loadVectorConfig, generateDefaultConfig } from './vector/config.ts';
import { warmEmbeddingProviderDetection } from './vector/provider-detection.ts';
import { vectorRoutes } from './routes/vector/index.ts';
import { createVectorProxyServer } from './vector/proxy-server.ts';
import { searchEndpoint } from './routes/search/search.ts';

import pkg from '../package.json' with { type: 'json' };

// ── Config ──────────────────────────────────────────────────────────
const config = loadVectorConfig() ?? generateDefaultConfig();
const PORT = Number(process.env.VECTOR_PORT ?? config.port);
void warmEmbeddingProviderDetection().catch((error) =>
  console.warn('[Vector] embedding provider auto-detect failed:', error instanceof Error ? error.message : String(error)));

// ── App ─────────────────────────────────────────────────────────────
export function createVectorServerApp() {
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
    .use(createVectorProxyServer({ version: pkg.version }))
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
