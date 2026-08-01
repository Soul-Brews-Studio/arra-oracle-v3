/**
 * Startup/shutdown orchestration helpers for the main HTTP server.
 *
 * Split out of src/server.ts (#2833 file-size ratchet) — these five functions
 * are only ever called from createStartedApp there; they don't touch route
 * composition (createApp/createServerRouteModules), so they're a separate
 * concern: the process lifecycle around the app, not the app itself.
 */
import { eq } from 'drizzle-orm';
import { db, sqlite, closeDb, indexingStatus, settings } from '../db/index.ts';
import { seedMenuItems, type HasRoutes as SeedHasRoutes } from '../db/seeders/menu-seeder.ts';
import { loadUnifiedPlugins, seedUnifiedPluginMenuItems } from '../plugins/unified-loader.ts';
import type { startUnifiedPluginServers } from '../plugins/unified-server.ts';
import type { PluginManifestWatcher } from '../plugins/watcher.ts';
import type { validateStartupEnv } from '../config/validate.ts';
import { PORT, VECTOR_URL } from '../config.ts';
import { closeCachedVectorStores } from '../vector/factory.ts';
import { fileWatcherService } from '../services/file-watcher.ts';
import { removePidFile } from '../process-manager/index.ts';
import { printStartupBanner } from './banner.ts';
import { createStartupSelfTest, runStartupSelfTest } from './self-test.ts';
import { readStartupDbStatus, runtimeMiddleware } from './startup-context.ts';
import { runShutdownSteps } from './shutdown.ts';
import pkg from '../../package.json' with { type: 'json' };

export type UnifiedRuntime = Awaited<ReturnType<typeof loadUnifiedPlugins>>;

export function resetIndexerStatus(): void {
  try {
    db.update(indexingStatus).set({ isIndexing: 0 }).where(eq(indexingStatus.id, 1)).run();
    console.log('🔮 Reset indexing status on startup');
  } catch {}
}

export function logBusyTimeout(): void {
  try { console.log(`[DB] busy_timeout = ${JSON.stringify(sqlite.prepare('PRAGMA busy_timeout').get())}`); } catch {}
}

export async function seedMenus(app: any, unifiedPlugins: UnifiedRuntime): Promise<void> {
  try {
    const result = seedMenuItems([app] as unknown as SeedHasRoutes[]);
    await seedUnifiedPluginMenuItems(unifiedPlugins.menu);
    console.log(`🔮 Menu seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.preserved} preserved`);
  } catch (e) { console.error('⚠️  Menu seeder failed:', e); }
}

export async function announceStartup(app: any, startupConfig: ReturnType<typeof validateStartupEnv>): Promise<void> {
  const dbStatus = () => readStartupDbStatus(() => db.select({ key: settings.key }).from(settings).limit(1).all());
  const middleware = runtimeMiddleware({ rateLimitTokensPerWindow: startupConfig.profile.rateLimit.tokensPerWindow, gatewayEnabled: Boolean(VECTOR_URL) || process.env.ORACLE_GATEWAY_HOT_RELOAD !== '0' });
  printStartupBanner({ version: pkg.version, port: Number(PORT), profile: startupConfig.profile.env, middleware, dbStatus: dbStatus() });
  await runStartupSelfTest({ checks: createStartupSelfTest({ dbPing: dbStatus, healthFetch: () => app.fetch(new Request(`http://127.0.0.1:${PORT}/api/health`)) }) });
}

export async function shutdownServer(unifiedPlugins: UnifiedRuntime, unifiedServers: Awaited<ReturnType<typeof startUnifiedPluginServers>>, pluginWatcher: PluginManifestWatcher, ownsPidFile: boolean): Promise<void> {
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
