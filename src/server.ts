import { Elysia } from 'elysia';
import { join } from 'node:path';
import { swagger } from '@elysiajs/swagger';
import { eq } from 'drizzle-orm';
import { configure, writePidFile, removePidFile } from './process-manager/index.ts';
import { PORT, ORACLE_DATA_DIR, VECTOR_URL } from './config.ts';
import { MCP_SERVER_NAME } from './const.ts';
import { db, sqlite, closeDb, indexingStatus, settings } from './db/index.ts';
import { isApiAuthorized, isApiPathProtected, unauthorizedApiResponse } from './server/api-token-auth.ts';
import { seedMenuItems, type HasRoutes as SeedHasRoutes } from './db/seeders/menu-seeder.ts';
import { createCorsMiddleware, createPrivateNetworkPreflightMiddleware } from './middleware/cors.ts';
import { createContentTypeMiddleware } from './middleware/content-type.ts';
import { createApiKeyAuthMiddleware } from './middleware/auth.ts';
import { createCorrelationMiddleware } from './middleware/correlation.ts';
import { defaultUnifiedPluginDirs, loadUnifiedPlugins, seedUnifiedPluginMenuItems } from './plugins/unified-loader.ts';
import { createUnifiedPluginRouteMount, createUnifiedRuntimeRef, type UnifiedRuntimeRef } from './plugins/runtime-routes.ts';
import { swapUnifiedRuntimeWithLifecycle } from './plugins/runtime-reload.ts';
import { startUnifiedPluginServers } from './plugins/unified-server.ts';
import { watchPluginManifests, type PluginManifestWatcher } from './plugins/watcher.ts';
import { closeCachedVectorStores } from './vector/factory.ts';
import { warmEmbeddingProviderDetection } from './vector/provider-detection.ts';
import { preflightVectorRuntime } from './vector/preflight.ts';
import { drainingResponseFor, isDraining, registerGracefulShutdown, runShutdownSteps, trackRequest } from './lifecycle/shutdown.ts';
import { createErrorMiddleware } from './middleware/errors.ts';
import { validateStartupEnv } from './config/validate.ts';
import { printStartupBanner } from './lifecycle/banner.ts';
import { createStartupSelfTest, runStartupSelfTest } from './lifecycle/self-test.ts';
import { readStartupDbStatus, runtimeMiddleware } from './lifecycle/startup-context.ts';
import { createRequestLoggingMiddleware } from './middleware/request-logger.ts';
import { createApiVersionHeaderMiddleware, createApiVersionedFetch } from './middleware/api-version.ts';
import { createSecurityHeadersMiddleware } from './middleware/security-headers.ts';
import { createRequestTimeoutFetch } from './middleware/timeout.ts';
import { createBodyLimitMiddleware } from './middleware/body-limit.ts';
import { createRateLimiterMiddleware } from './middleware/rate-limiter.ts';
import { createResponseFormatMiddleware } from './middleware/response-format.ts';
import { createNotFoundMiddleware } from './middleware/not-found.ts';
import { createEtagMiddleware } from './middleware/etag.ts';
import { createCompressMiddleware } from './middleware/compress.ts';
import { createRequestDedupFetch } from './middleware/dedup.ts';
import { createDbContextFetch } from './middleware/db-context.ts';
import { createTenantFetch, createTenantMiddleware } from './middleware/tenant.ts';
import { authRoutes } from './routes/auth/index.ts';
import { settingsRoutes } from './routes/settings/index.ts';
import { feedRoutes } from './routes/feed/index.ts';
import { createHealthRoutes } from './routes/health/index.ts';
import { dashboardRoutes } from './routes/dashboard/index.ts';
import { searchRoutes } from './routes/search/index.ts';
import { vectorRoutes } from './routes/vector/index.ts';
import { vectorConfigApiRoutes } from './routes/vector/config-api.ts';
import { conceptsRoutes } from './routes/concepts/index.ts';
import { knowledgeRoutes } from './routes/knowledge/index.ts';
import { verifyRoutes } from './routes/verify/index.ts';
import { supersedeRoutes } from './routes/supersede/index.ts';
import { forumApi } from './routes/forum/index.ts';
import { tracesApi } from './routes/traces/index.ts';
import { scheduleApi } from './routes/schedule/index.ts';
import { filesRouter } from './routes/files/index.ts';
import { createPluginsRouter } from './routes/plugins/index.ts';
import { sessionsRoutes } from './routes/sessions/index.ts';
import { vaultRoutes } from './routes/vault/index.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from './routes/menu/index.ts';
import { createMcpRoutes } from './routes/mcp/index.ts';
import { createMetricsLifecycle, metricsRoutes } from './routes/metrics/index.ts';
import { exportRoutes } from './routes/export/index.ts';
import { memoryRoutes } from './routes/memory/index.ts';
import { canvasRoutes } from './routes/canvas/index.ts';
import { tenantsRoutes } from './routes/tenants/index.ts';
import { watcherRoutes } from './routes/watcher/index.ts';
import { indexerRoutes } from './routes/indexer/index.ts';
import { fileWatcherService } from './services/file-watcher.ts';
import { gatewayPlugin } from './gateway/index.ts';
import pkg from '../package.json' with { type: 'json' };

type UnifiedRuntime = Awaited<ReturnType<typeof loadUnifiedPlugins>>;
type ServerSpec = { port: number; fetch(request: Request): Response | Promise<Response> };
export interface StartServerOptions { writePidFile?: boolean }

export interface CreateAppOptions {
  unifiedPlugins: UnifiedRuntime;
  runtimeRef?: UnifiedRuntimeRef<UnifiedRuntime>;
  dataDir?: string;
  vectorUrl?: string;
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
    .use(swagger({ provider: 'swagger-ui', path: '/api/docs', specPath: '/api/docs/json', swaggerOptions: { url: '/api/docs/json' } as any, documentation: { info: { title: 'Arra Oracle API', version: pkg.version, description: 'HTTP API for the Arra Oracle MCP memory layer.' } } }))
    .use(createResponseFormatMiddleware())
    .use(createCompressMiddleware())
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
    .get('/', () => ({ server: MCP_SERVER_NAME, version: pkg.version, status: 'ok', docs: '/api/docs', api: '/api/v1' }));

  const healthRoutes = createHealthRoutes({ pluginCount: unifiedPlugins.pluginCount, pluginMcpToolCount: unifiedPlugins.mcpTools.length, pluginStatuses: unifiedPlugins.pluginStatuses, isDraining });
  const apiModules = [authRoutes, settingsRoutes, feedRoutes, healthRoutes, dashboardRoutes, searchRoutes, vectorRoutes, vectorConfigApiRoutes, conceptsRoutes, knowledgeRoutes, verifyRoutes, supersedeRoutes, forumApi, tracesApi, scheduleApi, filesRouter, createPluginsRouter({ registry: () => runtimeRef.current.pluginRegistry(), runtimeRef }), sessionsRoutes, vaultRoutes, metricsRoutes, exportRoutes, memoryRoutes, canvasRoutes, tenantsRoutes, watcherRoutes, indexerRoutes];
  const modules = [...apiModules, createMcpRoutes({ runtimeRef }), createMenuRoutes(menuItemsFromUnifiedPlugins(unifiedPlugins.menu))];
  for (const mod of modules) app.use(mod as any);
  app.use(createUnifiedPluginRouteMount(runtimeRef, { localRoutes: () => app.routes }));
  app.use(createNotFoundMiddleware(() => app.routes));
  return app;
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
  registerGracefulShutdown({ close: async () => shutdown(runtimeRef.current, runtimeLifecycle.servers, pluginWatcher, ownsPidFile) });

  const app = createApp({ unifiedPlugins, runtimeRef });
  await seedMenus(app, unifiedPlugins);
  await announceStartup(app, startupConfig);
  const serverFetch = createRequestTimeoutFetch(createRequestDedupFetch(createApiVersionedFetch(createTenantFetch(createDbContextFetch((request: Request) => app.fetch(request))))));
  return { port: Number(PORT), fetch: (request) => drainingResponseFor(request) ?? trackRequest(() => serverFetch(request)) };
}

function resetIndexerStatus(): void {
  try {
    db.update(indexingStatus).set({ isIndexing: 0 }).where(eq(indexingStatus.id, 1)).run();
    console.log('🔮 Reset indexing status on startup');
  } catch {}
}

function logBusyTimeout(): void {
  try { console.log(`[DB] busy_timeout = ${JSON.stringify(sqlite.prepare('PRAGMA busy_timeout').get())}`); } catch {}
}

async function seedMenus(app: any, unifiedPlugins: UnifiedRuntime): Promise<void> {
  try {
    const result = seedMenuItems([app] as unknown as SeedHasRoutes[]);
    await seedUnifiedPluginMenuItems(unifiedPlugins.menu);
    console.log(`🔮 Menu seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.preserved} preserved`);
  } catch (e) { console.error('⚠️  Menu seeder failed:', e); }
}

async function announceStartup(app: any, startupConfig: ReturnType<typeof validateStartupEnv>): Promise<void> {
  const dbStatus = () => readStartupDbStatus(() => db.select({ key: settings.key }).from(settings).limit(1).all());
  const middleware = runtimeMiddleware({ rateLimitTokensPerWindow: startupConfig.profile.rateLimit.tokensPerWindow, gatewayEnabled: Boolean(VECTOR_URL) || process.env.ORACLE_GATEWAY_HOT_RELOAD !== '0' });
  printStartupBanner({ version: pkg.version, port: Number(PORT), profile: startupConfig.profile.env, middleware, dbStatus: dbStatus() });
  await runStartupSelfTest({ checks: createStartupSelfTest({ dbPing: dbStatus, healthFetch: () => app.fetch(new Request(`http://127.0.0.1:${PORT}/api/health`)) }) });
}

async function shutdown(unifiedPlugins: UnifiedRuntime, unifiedServers: Awaited<ReturnType<typeof startUnifiedPluginServers>>, pluginWatcher: PluginManifestWatcher, ownsPidFile: boolean): Promise<void> {
  console.log('\n🔮 Shutting down gracefully...');
  await runShutdownSteps([
    { name: 'file-watcher', run: () => { fileWatcherService.stop(); } },
    { name: 'unified-plugin-watcher', run: () => { pluginWatcher.close(); } },
    { name: 'unified-plugins', run: () => unifiedPlugins.stop() },
    { name: 'unified-plugin-servers', run: () => unifiedServers.stop() },
    { name: 'vector-stores', run: () => closeCachedVectorStores() },
    { name: 'database', run: () => closeDb() },
    ...(ownsPidFile ? [{ name: 'pid-file', run: () => removePidFile() }] : []),
  ], console.warn);
  console.log('👋 Arra Oracle HTTP Server stopped.');
}

if (import.meta.main) {
  const server = await startServer();
  console.log(`🔮 Oracle HTTP Server listening on http://localhost:${server.port}`);
}
