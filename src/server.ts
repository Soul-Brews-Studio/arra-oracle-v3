import { ensureExtensionCapableSqlite } from './vector/sqlite-runtime.ts';
ensureExtensionCapableSqlite();

import { Elysia } from 'elysia';
import { join } from 'node:path';
import { swagger } from '@elysiajs/swagger';
import { configure, writePidFile } from './process-manager/index.ts';
import { PORT, ORACLE_DATA_DIR, VECTOR_URL } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';
import { sqlite } from './db/index.ts';
import { isApiAuthorized, isApiPathProtected, unauthorizedApiResponse } from './server/api-token-auth.ts';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware } from './middleware/cors.ts';
import { createContentTypeMiddleware } from './middleware/content-type.ts';
import { createApiKeyAuthMiddleware } from './middleware/auth.ts';
import { createCorrelationMiddleware } from './middleware/correlation.ts';
import { defaultUnifiedPluginDirs, loadUnifiedPlugins } from './plugins/unified-loader.ts';
import { createUnifiedPluginRouteMount, createUnifiedRuntimeRef, type UnifiedRuntimeRef } from './plugins/runtime-routes.ts';
import { swapUnifiedRuntimeWithLifecycle } from './plugins/runtime-reload.ts';
import { startUnifiedPluginServers } from './plugins/unified-server.ts';
import { watchPluginManifests } from './plugins/watcher.ts';
import { warmEmbeddingProviderDetection } from './vector/provider-detection.ts';
import { preflightVectorRuntime } from './vector/preflight.ts';
import { drainingResponseFor, isDraining, registerGracefulShutdown, trackRequest } from './lifecycle/shutdown.ts';
import { PUBLIC_ENDPOINTS, apiRootResponse } from './routes/meta/endpoints.ts';
import { createErrorMiddleware } from './middleware/errors.ts';
import { validateStartupEnv } from './config/validate.ts';
import { resetIndexerStatus, logBusyTimeout, seedMenus, announceStartup, shutdownServer } from './lifecycle/server-startup.ts';
import { createRequestLoggingMiddleware } from './middleware/request-logger.ts';
import { createApiVersionHeaderMiddleware, createApiVersionedFetch } from './middleware/api-version.ts';
import { createSecurityHeadersMiddleware } from './middleware/security-headers.ts';
import { createRequestTimeoutFetch } from './middleware/timeout.ts';
import { createBodyLimitMiddleware } from './middleware/body-limit.ts';
import { createRateLimiterMiddleware } from './middleware/rate-limiter.ts';
import { createResponseFormatMiddleware } from './middleware/response-format.ts';
import { createNotFoundMiddleware } from './middleware/not-found.ts';
import { createOpenApiSwaggerConfig, openApiSpecHandler } from './openapi/index.ts';
import { createEtagMiddleware } from './middleware/etag.ts';
import { createCompressMiddleware } from './middleware/compress.ts';
import { createRequestDedupFetch } from './middleware/dedup.ts';
import { createDbContextFetch } from './middleware/db-context.ts';
import { createTenantFetch, createTenantMiddleware } from './middleware/tenant.ts';
import { authRoutes } from './routes/auth/index.ts';
import { settingsRoutes } from './routes/settings/index.ts';
import { feedRoutes } from './routes/feed/index.ts';
import { createHealthRoutes } from './routes/health/index.ts';
import { createFleetLogRoutes } from './routes/fleet-log/index.ts';
import { dashboardRoutes } from './routes/dashboard/index.ts';
import { searchRoutes } from './routes/search/index.ts';
import { askRoutes } from './routes/ask/index.ts';
import { paidAskRoutes } from './routes/x402/index.ts';
import { x402StatsRoutes } from './routes/x402/stats.ts';
import { vectorRoutes } from './routes/vector/index.ts';
import { vectorConfigApiRoutes } from './routes/vector/config-api.ts';
import { conceptsRoutes } from './routes/concepts/index.ts';
import { knowledgeRoutes } from './routes/knowledge/index.ts';
import { researchRoutes } from './routes/research/index.ts';
import { verifyRoutes } from './routes/verify/index.ts';
import { supersedeRoutes } from './routes/supersede/index.ts';
import { forumApi } from './routes/forum/index.ts';
import { tracesApi } from './routes/traces/index.ts';
import { scheduleApi } from './routes/schedule/index.ts';
import { filesRouter } from './routes/files/index.ts';
import { createPluginsRouter } from './routes/plugins/index.ts';
import { sessionsRoutes } from './routes/sessions/index.ts';
import { oldStudioCompatRoutes } from './routes/compat.ts';
import { vaultRoutes } from './routes/vault/index.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from './routes/menu/index.ts';
import { createMcpRoutes, createMcpStreamableRoutes } from './routes/mcp/index.ts';
import { createMetricsLifecycle, metricsRoutes } from './routes/metrics/index.ts';
import { exportRoutes } from './routes/export/index.ts';
import { memoryRoutes } from './routes/memory/index.ts';
import { canvasRoutes } from './routes/canvas/index.ts';
import { tenantsRoutes } from './routes/tenants/index.ts';
import { watcherRoutes } from './routes/watcher/index.ts';
import { indexerRoutes } from './routes/indexer/index.ts';
import { fileWatcherService } from './services/file-watcher.ts';
import { createSleepConsolidationWorker } from './workers/sleep-consolidation.ts';
import { createEntityBackfillWorker } from './workers/entity-backfill.ts';
import { gatewayPlugin } from './gateway/index.ts';
import { createSpaMiddleware } from './middleware/spa.ts';
import { simpleModeResponse } from './simple-mode.ts';
import pkg from '../package.json' with { type: 'json' };

type UnifiedRuntime = Awaited<ReturnType<typeof loadUnifiedPlugins>>;
type ServerSpec = { port: number; fetch(request: Request): Response | Promise<Response> };
type ElysiaApp = Elysia<any, any, any, any, any, any, any>;
type RouteModule = Parameters<ElysiaApp['use']>[0];
export interface StartServerOptions { writePidFile?: boolean }

export interface CreateAppOptions {
  unifiedPlugins: UnifiedRuntime;
  runtimeRef?: UnifiedRuntimeRef<UnifiedRuntime>;
  dataDir?: string;
  vectorUrl?: string;
}

// GMT+7 (Asia/Bangkok) ISO timestamp — the fleet's primary time zone.
function gmt7Now(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace('Z', '+07:00');
}

// Cheap SQLite counts for the root status endpoint. Full breakdown (by-type +
// embeddings) lives at /api/v1/stats; this is the lightweight at-a-glance view.
// Guarded so a blank/fresh instance (no tables yet) reports nulls, not a 500.
function rootCounts(): { documents: number | null; ftsIndexed: number | null; indexing: boolean | null } {
  const one = (q: string): number | null => {
    try { return (sqlite.prepare(q).get() as { c: number }).c; } catch { return null; }
  };
  const indexing = (() => {
    try { return ((sqlite.prepare('SELECT is_indexing AS c FROM indexing_status LIMIT 1').get() as { c: number } | undefined)?.c ?? 0) === 1; }
    catch { return null; }
  })();
  return {
    documents: one('SELECT COUNT(*) AS c FROM oracle_documents'),
    ftsIndexed: one('SELECT COUNT(*) AS c FROM oracle_fts'),
    indexing,
  };
}

export function createApp({ unifiedPlugins, runtimeRef = createUnifiedRuntimeRef(unifiedPlugins), dataDir = ORACLE_DATA_DIR, vectorUrl = VECTOR_URL }: CreateAppOptions) {
  const app = new Elysia()
    .use(createRequestLoggingMiddleware())
    .use(createCorrelationMiddleware())
    .use(createTenantMiddleware())
    .use(createPrivateNetworkPreflightMiddleware())
    .use(createCorsMiddleware())
    .use(createApiVersionHeaderMiddleware())
    .use(createSecurityHeadersMiddleware())
    .use(createContentTypeMiddleware())
    .use(createBodyLimitMiddleware())
    .use(createApiKeyAuthMiddleware())
    .use(createRateLimiterMiddleware())
    .use(createMetricsLifecycle())
    .use(swagger(createOpenApiSwaggerConfig(pkg.version)))
    .use(createResponseFormatMiddleware())
    .use(createCompressMiddleware())
    .use(createSpaMiddleware())
    .use(createEtagMiddleware())
    .onBeforeHandle(({ request, set }) => {
      const pathname = new URL(request.url).pathname;
      if (isApiPathProtected(pathname) && !isApiAuthorized(request)) { set.status = 401; return unauthorizedApiResponse(); }
    })
    .onAfterHandle(({ set }) => {
      set.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    })
    .use(createErrorMiddleware())
    .use(gatewayPlugin(dataDir, vectorUrl || undefined))
    .get('/swagger', () => Response.redirect('/api/docs', 308), { detail: { hide: true } })
    .get('/swagger/json', () => Response.redirect('/api/docs/json', 308), { detail: { hide: true } })
    .get('/api/openapi.json', () => Response.redirect('/api/docs/json', 308), { detail: { hide: true } })
    // Registered at '/api', which is the PUBLIC '/api/v1' — api-version.ts rewrites the
    // versioned prefix away before routing. Advertised as `api` and returned 404 until now.
    .get('/api', () => apiRootResponse(pkg.version), {
      detail: { tags: ['meta'], summary: 'API root — lists versioned endpoints' },
    })
    .get('/simple', ({ set }) => simpleModeResponse(set), { detail: { tags: ['frontend'], summary: 'Simple Mode entry page' } })
    .get('/', () => ({
      server: MCP_SERVER_NAME,
      version: pkg.version,
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      plugins: unifiedPlugins.pluginCount,
      pluginMcpTools: unifiedPlugins.mcpTools.length,
      counts: rootCounts(),
      docs: PUBLIC_ENDPOINTS.docs,
      api: PUBLIC_ENDPOINTS.api,
      endpoints: PUBLIC_ENDPOINTS,
      config: {
        port: Number(PORT),
        dataDir,
        vector: vectorUrl ? `proxy:${vectorUrl}` : 'local',
      },
      runtime: { bun: Bun.version },
      generatedAt: gmt7Now(),
    }));

  const routeModules = createServerRouteModules(unifiedPlugins, runtimeRef);
  mountRouteModules(app, routeModules);
  app.get('/api/docs/json', openApiSpecHandler(app), { detail: { hide: true } });
  app.use(createUnifiedPluginRouteMount(runtimeRef, { localRoutes: () => app.routes }));
  app.use(createNotFoundMiddleware(() => app.routes));
  return app;
}

export function createServerRouteModules(unifiedPlugins: UnifiedRuntime, runtimeRef: UnifiedRuntimeRef<UnifiedRuntime>): RouteModule[] {
  const healthRoutes = createHealthRoutes({ pluginCount: unifiedPlugins.pluginCount, pluginMcpToolCount: unifiedPlugins.mcpTools.length, pluginStatuses: unifiedPlugins.pluginStatuses, isDraining });
  const apiModules = [authRoutes, settingsRoutes, feedRoutes, healthRoutes, dashboardRoutes, searchRoutes, askRoutes, paidAskRoutes, x402StatsRoutes, vectorRoutes, vectorConfigApiRoutes, conceptsRoutes, knowledgeRoutes, researchRoutes, verifyRoutes, supersedeRoutes, forumApi, tracesApi, scheduleApi, filesRouter, createPluginsRouter({ registry: () => runtimeRef.current.pluginRegistry(), runtimeRef }), sessionsRoutes, oldStudioCompatRoutes, vaultRoutes, metricsRoutes, exportRoutes, memoryRoutes, canvasRoutes, tenantsRoutes, watcherRoutes, indexerRoutes, createFleetLogRoutes()];
  return [...apiModules, createMcpRoutes({ runtimeRef }), createMcpStreamableRoutes(), createMenuRoutes(menuItemsFromUnifiedPlugins(unifiedPlugins.menu))];
}

export function mountRouteModules(app: ElysiaApp, modules: RouteModule[]): void {
  modules.forEach((mod, index) => {
    assertRouteModule(mod, index);
    app.use(mod as any);
  });
}

function assertRouteModule(mod: unknown, index: number): asserts mod is RouteModule {
  if (typeof mod !== 'function' && !(mod instanceof Elysia)) {
    throw new Error(`Invalid server route module at index ${index}`);
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<ReturnType<typeof Bun.serve>> {
  const app = await createStartedApp(options);
  return Bun.serve(app);
}

export async function createStartedApp(options: StartServerOptions = {}): Promise<ServerSpec> {
  const startupConfig = validateStartupEnv();
  resetIndexerStatus();
  const vectorPreflight = await preflightVectorRuntime({ warn: (message) => console.warn(message) });
  console.log('[Vector] mode:', vectorPreflight.vectorUrl ? 'proxy → ' + vectorPreflight.vectorUrl : vectorPreflight.vectorMode);
  void warmEmbeddingProviderDetection().catch((error) => console.warn('[Vector] embedding provider auto-detect failed:', error instanceof Error ? error.message : String(error)));
  logBusyTimeout();
  const ownsPidFile = options.writePidFile !== false;
  if (ownsPidFile) {
    configure({ dataDir: ORACLE_DATA_DIR, pidFileName: 'oracle-http.pid' });
    writePidFile({ pid: process.pid, port: Number(PORT), startedAt: new Date().toISOString(), name: 'oracle-http' });
  }
  if (process.env.ORACLE_FILE_WATCHER !== '0') fileWatcherService.start();
  const consolidationWorker = createSleepConsolidationWorker(sqlite);
  const entityBackfillWorker = createEntityBackfillWorker(sqlite);
  consolidationWorker.start();
  entityBackfillWorker.start();
  registerGracefulShutdown({ close: async () => { consolidationWorker.stop(); entityBackfillWorker.stop(); } });

  const pluginDirs = defaultUnifiedPluginDirs([join(import.meta.dir, 'plugins')]);
  const pluginWarn = (message: string) => console.warn(message);
  const unifiedPlugins = await loadUnifiedPlugins({ dirs: pluginDirs, warn: pluginWarn });
  await unifiedPlugins.init();
  const runtimeRef = createUnifiedRuntimeRef(unifiedPlugins);
  const runtimeLifecycle = { servers: await startUnifiedPluginServers(unifiedPlugins.servers, pluginWarn) };
  const pluginWatcher = watchPluginManifests({
    dirs: pluginDirs,
    warn: pluginWarn,
    onReload: (runtime) => swapUnifiedRuntimeWithLifecycle(runtimeRef, runtimeLifecycle, runtime, { warn: pluginWarn }),
  });
  registerGracefulShutdown({ close: async () => shutdownServer(runtimeRef.current, runtimeLifecycle.servers, pluginWatcher, ownsPidFile) });

  const app = createApp({ unifiedPlugins, runtimeRef });
  await seedMenus(app, unifiedPlugins);
  await announceStartup(app, startupConfig);
  const serverFetch = createRequestTimeoutFetch(createRequestDedupFetch(createApiVersionedFetch(createTenantFetch(createDbContextFetch((request: Request) => app.fetch(request))))));
  return { port: Number(PORT), fetch: (request) => drainingResponseFor(request) ?? trackRequest(() => serverFetch(request)) };
}

if (import.meta.main) {
  const server = await startServer();
  console.log(`🔮 Oracle HTTP Server listening on http://localhost:${server.port}`);
}
