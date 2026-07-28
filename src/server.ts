/**
 * Arra Oracle HTTP Server — Elysia (bun-native).
 *
 * Composes built-in server plugins from src/server/plugin/. The loader owns
 * route mounting, manifest API prefixes, and lifecycle startup/shutdown.
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
import { createBuiltinServerPlugins } from './server/plugin/builtin.ts';
import {
  disabledPluginsFromEnv,
  enabledPluginsFromEnv,
  enabledServerPlugins,
  loadServerPlugins,
  menuSeedRoutes,
  serverPluginRoutes,
  startServerPlugins,
} from './server/plugin/loader.ts';
import { registerServerPlugins } from './server/plugin/registry.ts';
import type { StartedServerPlugins } from './server/plugin/types.ts';

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

const builtInPlugins = await createBuiltinServerPlugins({
  dataDir: ORACLE_DATA_DIR,
  vectorUrl: VECTOR_URL || undefined,
});
const loadedPlugins = loadServerPlugins(builtInPlugins, {
  disabledPlugins: disabledPluginsFromEnv(),
  enabledPlugins: enabledPluginsFromEnv(),
});
const enabledPlugins = enabledServerPlugins(loadedPlugins);
registerServerPlugins(loadedPlugins);
let pluginLifecycle: StartedServerPlugins | null = null;

registerSignalHandlers(async () => {
  console.log('\n🔮 Shutting down gracefully...');
  try {
    await pluginLifecycle?.stop();
  } catch (error) {
    console.warn('[server-plugin] lifecycle stop failed:', error);
  }
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
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return origin;
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
      origin: (request) => originAllowed(request.headers.get('origin')) !== null,
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
  .get('/', () => ({
    server: MCP_SERVER_NAME,
    version: pkg.version,
    status: 'ok',
    docs: '/swagger',
    api: '/api',
  }));

try {
  const result = seedMenuItems(menuSeedRoutes(enabledPlugins) as unknown as SeedHasRoutes[]);
  console.log(
    `🔮 Menu seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.preserved} preserved`,
  );
} catch (e) {
  console.error('⚠️  Menu seeder failed:', e);
}

for (const mod of serverPluginRoutes(enabledPlugins, { warn: console.warn })) app.use(mod as any);
pluginLifecycle = await startServerPlugins(enabledPlugins, {
  dataDir: ORACLE_DATA_DIR,
  vectorUrl: VECTOR_URL || undefined,
  logger: console,
});

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
