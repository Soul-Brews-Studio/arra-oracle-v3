/**
 * Arra Oracle HTTP Server — Elysia (bun-native).
 *
 * Composes 15 route modules from src/routes/. Every module is its own
 * Elysia sub-app, nested one file per endpoint.
 */

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { eq } from 'drizzle-orm';

import {
  configure,
  writePidFile,
  removePidFile,
  registerSignalHandlers,
  performGracefulShutdown,
} from './process-manager/index.ts';

import { PORT, ORACLE_DATA_DIR, VECTOR_URL } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';
import { db, sqlite, closeDb, indexingStatus } from './db/index.ts';
import { seedMenuItems, type HasRoutes as SeedHasRoutes } from './db/seeders/menu-seeder.ts';

// Elysia sub-apps — one per cluster
import { authRoutes } from './routes/auth/index.ts';
import { settingsRoutes } from './routes/settings/index.ts';
import { feedRoutes } from './routes/feed/index.ts';
import { healthRoutes } from './routes/health/index.ts';
import { dashboardRoutes } from './routes/dashboard/index.ts';
import { searchRoutes } from './routes/search/index.ts';
import { vectorRoutes } from './routes/vector/index.ts';
import { knowledgeRoutes } from './routes/knowledge/index.ts';
import { supersedeRoutes } from './routes/supersede/index.ts';
import { forumApi } from './routes/forum/index.ts';
import { tracesApi } from './routes/traces/index.ts';
import { scheduleApi } from './routes/schedule/index.ts';
import { filesRouter } from './routes/files/index.ts';
import { pluginsRouter } from './routes/plugins/index.ts';
import { oraclenetRoutes } from './routes/oraclenet/index.ts';
import { sessionsRoutes } from './routes/sessions/index.ts';
import { vaultRoutes } from './routes/vault/index.ts';
import { peerRoutes } from './routes/peer/index.ts';
import { createMenuRoutes } from './routes/menu/index.ts';

// Indexer routes are optional — MCP server works without them
let indexerRoutes: any = null;
try {
  indexerRoutes = (await import('./routes/indexer/index.ts')).indexerRoutes;
} catch {
  console.log('[Indexer] Routes not loaded — indexer is optional');
}
import { gatewayPlugin } from './gateway/index.ts';

import pkg from '../package.json' with { type: 'json' };

try {
  db.update(indexingStatus).set({ isIndexing: 0 }).where(eq(indexingStatus.id, 1)).run();
  console.log('🔮 Reset indexing status on startup');
} catch (e) {
  // table might not exist yet — fine on first boot
}

console.log('[Vector] mode:', VECTOR_URL ? 'proxy → ' + VECTOR_URL : 'local');

try {
  const bt = sqlite.prepare('PRAGMA busy_timeout').get();
  console.log(`[DB] busy_timeout = ${JSON.stringify(bt)}`);
} catch {}

configure({ dataDir: ORACLE_DATA_DIR, pidFileName: 'oracle-http.pid' });
writePidFile({
  pid: process.pid,
  port: Number(PORT),
  startedAt: new Date().toISOString(),
  name: 'oracle-http',
});

registerSignalHandlers(async () => {
  console.log('\n🔮 Shutting down gracefully...');
  await performGracefulShutdown({
    resources: [{ close: () => { closeDb(); return Promise.resolve(); } }],
  });
  removePidFile();
  console.log('👋 Arra Oracle HTTP Server stopped.');
});

const DEFAULT_ALLOWED_ORIGINS = [
  'https://studio.buildwithoracle.com',
  'https://neo.buildwithoracle.com',
];
const envExtraOrigins = (process.env.ORACLE_CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const legacyOrigin = process.env.CORS_ORIGIN?.trim();
const ALLOWED_ORIGINS = [
  ...DEFAULT_ALLOWED_ORIGINS,
  ...envExtraOrigins,
  ...(legacyOrigin ? [legacyOrigin] : []),
];

function originAllowed(origin: string | undefined | null): string | null {
  if (!origin) return null;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return origin;
  }
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol === 'https:' && (hostname === 'buildwithoracle.com' || hostname.endsWith('.buildwithoracle.com'))) {
      return origin;
    }
  } catch {}
  return null;
}

// Private Network Access preflight (Chrome 117+). Must intercept OPTIONS
// before @elysiajs/cors, because the cors plugin answers preflights itself
// without emitting the `Access-Control-Allow-Private-Network` header that
// Chrome requires for https→localhost fetches.
const pnaMiddleware = new Elysia().onRequest(({ request }) => {
  if (
    request.method === 'OPTIONS' &&
    request.headers.get('access-control-request-private-network') === 'true'
  ) {
    const origin = originAllowed(request.headers.get('origin'));
    if (!origin) return;
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
        'Access-Control-Allow-Headers':
          request.headers.get('access-control-request-headers') ?? 'content-type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }
});

const app = new Elysia()
  .use(pnaMiddleware)
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin');
        return originAllowed(origin) !== null;
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    }),
  )
  .onAfterHandle(({ set }) => {
    set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    set.headers['X-Content-Type-Options'] = 'nosniff';
    set.headers['X-Frame-Options'] = 'DENY';
    set.headers['X-XSS-Protection'] = '1; mode=block';
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  })
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    const msg = (error as any)?.message ?? String(error);
    const isDbLock = msg.includes('disk I/O') || msg.includes('database is locked') || msg.includes('SQLITE_BUSY');
    if (isDbLock) {
      set.status = 503;
      return { error: 'Database temporarily unavailable (indexing in progress)', indexing: true, detail: msg };
    }
    set.status = 500;
    return { error: msg };
  })
  .use(
    swagger({
      path: '/swagger',
      documentation: {
        info: {
          title: 'Arra Oracle API',
          version: pkg.version,
          description: 'HTTP API for the Arra Oracle MCP memory layer.',
        },
      },
    }),
  )
  .use(gatewayPlugin(ORACLE_DATA_DIR, VECTOR_URL || undefined))
  .use(peerRoutes)
  .get('/', () => ({
    server: MCP_SERVER_NAME,
    version: pkg.version,
    status: 'ok',
    docs: '/swagger',
    api: '/api',
  }));

const apiModules = [
  authRoutes,
  settingsRoutes,
  feedRoutes,
  healthRoutes,
  dashboardRoutes,
  searchRoutes,
  vectorRoutes,
  knowledgeRoutes,
  supersedeRoutes,
  forumApi,
  tracesApi,
  scheduleApi,
  filesRouter,
  pluginsRouter,
  oraclenetRoutes,
  sessionsRoutes,
  vaultRoutes,
  ...(indexerRoutes ? [indexerRoutes] : []),
];

try {
  const result = seedMenuItems(apiModules as unknown as SeedHasRoutes[]);
  console.log(
    `🔮 Menu seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.preserved} preserved`,
  );
} catch (e) {
  console.error('⚠️  Menu seeder failed:', e);
}

const menuRoutes = createMenuRoutes();

const modules = [...apiModules, menuRoutes];

for (const mod of modules) app.use(mod as any);

console.log(`
🔮 Arra Oracle HTTP Server running! (Elysia)

   URL:     http://localhost:${PORT}
   Swagger: http://localhost:${PORT}/swagger
   Version: ${pkg.version}
`);

export default {
  port: Number(PORT),
  fetch: app.fetch,
};
