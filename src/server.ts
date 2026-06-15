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
} from './process-manager/index.ts';
import { PORT, ORACLE_DATA_DIR, VECTOR_URL } from './config.ts';
import { ScoutAnnouncer, shouldStartScoutAnnouncer } from './peer/scout-announcer.ts';
import { MCP_SERVER_NAME } from './const.ts';
import { db, sqlite, closeDb, indexingStatus, settings } from './db/index.ts';
import { isApiAuthorized, isApiPathProtected, unauthorizedApiResponse } from './server/api-token-auth.ts';
import { seedMenuItems, type HasRoutes as SeedHasRoutes } from './db/seeders/menu-seeder.ts';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware } from './middleware/cors.ts';
import { createContentTypeMiddleware } from './middleware/content-type.ts';
import { createApiKeyAuthMiddleware } from './middleware/auth.ts';
import { createCorrelationMiddleware } from './middleware/correlation.ts';
import { loadUnifiedPlugins, seedUnifiedPluginMenuItems } from './plugins/unified-loader.ts';
import { startUnifiedPluginServers } from './plugins/unified-server.ts';
import { closeCachedVectorStores } from './vector/factory.ts';
import { isDraining, registerGracefulShutdown, trackRequest } from './lifecycle/shutdown.ts';
import { createErrorMiddleware } from './middleware/errors.ts';
import { validateStartupEnv } from './config/validate.ts';
import { printStartupBanner, type BannerMiddleware } from './lifecycle/banner.ts';
import { createRequestLogger } from './middleware/logger.ts';
import { createRateLimitMiddleware } from './middleware/rate-limit.ts';
import { createApiVersionHeaderMiddleware, createApiVersionedFetch } from './middleware/api-version.ts';
import { createSecurityHeadersMiddleware } from './middleware/security-headers.ts';
import { createRequestTimeoutFetch } from './middleware/timeout.ts';

// Elysia sub-apps — one per cluster
import { authRoutes } from './routes/auth/index.ts';
import { settingsRoutes } from './routes/settings/index.ts';
import { feedRoutes } from './routes/feed/index.ts';
import { createHealthRoutes } from './routes/health/index.ts';
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
import { createMetricsLifecycle, metricsRoutes } from './routes/metrics/index.ts';

// Indexer routes are optional — MCP server works without them
let indexerRoutes: any = null;
try {
  indexerRoutes = (await import('./routes/indexer/index.ts')).indexerRoutes;
} catch {
  console.log('[Indexer] Routes not loaded — indexer is optional');
}
import { gatewayPlugin } from './gateway/index.ts';

import pkg from '../package.json' with { type: 'json' };

const startupConfig = validateStartupEnv();

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
await unifiedPlugins.init();
const unifiedServers = await startUnifiedPluginServers(unifiedPlugins.servers);

registerGracefulShutdown({
  close: async () => {
    console.log('\n🔮 Shutting down gracefully...');
    scoutAnnouncer?.stop();
    await unifiedPlugins.stop();
    await unifiedServers.stop();
    await closeCachedVectorStores();
    closeDb();
    removePidFile();
    console.log('👋 Arra Oracle HTTP Server stopped.');
  },
});

const requestLogger = createRequestLogger();

const app = new Elysia()
  .onRequest(requestLogger.onRequest)
  .use(createPrivateNetworkPreflightMiddleware())
  .use(createCorsMiddleware())
  .use(createApiVersionHeaderMiddleware())
  .use(createSecurityHeadersMiddleware())
  .use(createContentTypeMiddleware())
  .use(createCorrelationMiddleware())
  .use(createRateLimitMiddleware())
  .use(createApiKeyAuthMiddleware())
  .use(createMetricsLifecycle())
  .onBeforeHandle(({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    if (isApiPathProtected(pathname) && !isApiAuthorized(request)) {
      set.status = 401;
      return unauthorizedApiResponse();
    }
  })
  .onAfterHandle(({ set }) => {
    set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  })
  .onAfterResponse(requestLogger.onAfterResponse)
  .use(createErrorMiddleware())
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
    api: '/api/v1',
  }));

const healthRoutes = createHealthRoutes({
  pluginCount: unifiedPlugins.pluginCount,
  pluginMcpToolCount: unifiedPlugins.mcpTools.length,
  pluginStatuses: unifiedPlugins.pluginStatuses,
  isDraining,
});

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
  metricsRoutes,
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

printStartupBanner({
  version: pkg.version,
  port: Number(PORT),
  profile: startupConfig.profile.env,
  middleware: enabledMiddleware(),
  dbStatus: startupDbStatus(),
});

function startupDbStatus(): string {
  try {
    db.select({ key: settings.key }).from(settings).limit(1).all();
    return 'ok';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `degraded (${message})`;
  }
}

function enabledMiddleware(): BannerMiddleware[] {
  return [
    { name: 'request-logger' },
    { name: 'private-network-preflight' },
    { name: 'cors' },
    { name: 'correlation' },
    { name: 'rate-limit', detail: `${startupConfig.profile.rateLimit.tokensPerWindow}/min` },
    { name: 'api-key-auth' },
    { name: 'metrics' },
    { name: 'structured-errors' },
    { name: 'swagger' },
    { name: 'gateway', enabled: Boolean(VECTOR_URL) || process.env.ORACLE_GATEWAY_HOT_RELOAD !== '0' },
  ];
}

const serverFetch = createRequestTimeoutFetch(createApiVersionedFetch((request) => app.fetch(request)));

export default {
  port: Number(PORT),
  fetch: (request: Request) => trackRequest(() => serverFetch(request)),
};
