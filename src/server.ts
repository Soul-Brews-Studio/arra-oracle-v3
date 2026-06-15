/**
 * Arra Oracle HTTP Server — Elysia (bun-native).
 *
 * Composes 15 route modules from src/routes/. Every module is its own
 * Elysia sub-app, nested one file per endpoint.
 */

import { Elysia } from 'elysia';
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
import { ScoutAnnouncer, shouldStartScoutAnnouncer } from './peer/scout-announcer.ts';
import { MCP_SERVER_NAME } from './const.ts';
import { db, sqlite, closeDb, indexingStatus } from './db/index.ts';
import { isApiAuthorized, isApiPathProtected, unauthorizedApiResponse } from './server/api-token-auth.ts';
import { seedMenuItems, type HasRoutes as SeedHasRoutes } from './db/seeders/menu-seeder.ts';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware } from './server/cors.ts';
import { loadUnifiedPlugins, seedUnifiedPluginMenuItems } from './plugins/unified-loader.ts';
import { startUnifiedPluginServers } from './plugins/unified-server.ts';

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
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from './routes/menu/index.ts';
import { peerRoutes } from './routes/peer/index.ts';
import { createMcpRoutes } from './routes/mcp/index.ts';

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

const scoutAnnouncer = shouldStartScoutAnnouncer() ? new ScoutAnnouncer() : null;
scoutAnnouncer?.start();

const unifiedPlugins = await loadUnifiedPlugins({ warn: (message) => console.warn(message) });
const unifiedServers = await startUnifiedPluginServers(unifiedPlugins.servers);

registerSignalHandlers(async () => {
  console.log('\n🔮 Shutting down gracefully...');
  await performGracefulShutdown({
    resources: [
      { close: () => { scoutAnnouncer?.stop(); return Promise.resolve(); } },
      { close: () => unifiedServers.stop() },
      { close: () => { closeDb(); return Promise.resolve(); } },
    ],
  });
  removePidFile();
  console.log('👋 Arra Oracle HTTP Server stopped.');
});

const app = new Elysia()
  .use(createPrivateNetworkPreflightMiddleware())
  .use(createCorsMiddleware())
  .onBeforeHandle(({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    if (isApiPathProtected(pathname) && !isApiAuthorized(request)) {
      set.status = 401;
      return unauthorizedApiResponse();
    }
  })
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
  ...unifiedPlugins.routes,
];

try {
  const result = seedMenuItems(apiModules as unknown as SeedHasRoutes[]);
  await seedUnifiedPluginMenuItems(unifiedPlugins.menu);
  console.log(
    `🔮 Menu seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.preserved} preserved`,
  );
} catch (e) {
  console.error('⚠️  Menu seeder failed:', e);
}

const menuRoutes = createMenuRoutes(menuItemsFromUnifiedPlugins(unifiedPlugins.menu));
const mcpRoutes = createMcpRoutes(unifiedPlugins.mcpTools);

const modules = [...apiModules, mcpRoutes, menuRoutes];

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
