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
import { vectorRoutes } from './routes/vector/index.ts';

import pkg from '../package.json' with { type: 'json' };

// ── Config ──────────────────────────────────────────────────────────
const config = loadVectorConfig() ?? generateDefaultConfig();
const PORT = Number(process.env.VECTOR_PORT ?? config.port);

// ── App ─────────────────────────────────────────────────────────────
const app = new Elysia()
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
  .use(vectorRoutes);

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
