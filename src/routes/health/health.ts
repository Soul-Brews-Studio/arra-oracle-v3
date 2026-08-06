import { Elysia } from 'elysia';
import { DB_PATH, PORT } from '../../config.ts';
import { MCP_SERVER_NAME } from '../../const.ts';
import { sqlite } from '../../db/index.ts';
import { scanPlugins } from '../plugins/model.ts';
import { readVectorBackendHealth } from '../../vector/health.ts';
import { getEmbedderRuntimeStatus, readEmbedderRuntimeStatus, resolveEmbeddingProviderSelection, type EmbedderRuntimeStatus } from '../../vector/embedder-config.ts';
import { getVectorRuntimeStatus, type VectorRuntimeStatus } from '../../vector/runtime-status.ts';
import { readVectorServerHealth, type VectorServerHealth } from './vector-server.ts';
import { memoryConfidenceRerankConfig } from '../memory/rerank-config.ts';
import { mcpTools } from '../../tools/mcp-manifest.ts';
import type { UnifiedPluginStatus } from '../../plugins/unified-loader.ts';
import { sandboxLabel } from '../../runtime/sandbox-label.ts';
import { healthRollupStatus } from './rollup.ts';
import { buildHealthSubsystems, drainingSubsystems, rollupHealthStatus, type EmbeddingProviderProbe, type EmbeddingProviderSelection } from './subsystems.ts';
import { sleepConsolidationStatus } from '../../workers/sleep-consolidation.ts';
import { entityBackfillStatus } from '../../workers/entity-backfill.ts';
import { readEntityCoverageStats, type EntityCoverageStats } from '../../search/entity-coverage.ts';
import pkg from '../../../package.json' with { type: 'json' };

type VectorHealth = Awaited<ReturnType<typeof readVectorBackendHealth>>;
type DbStatus = { status: 'connected' } | { status: 'error'; error: string };
type DbPing = () => DbStatus | Promise<DbStatus>;

type DiskHealth = {
  status: 'ok' | 'warning' | 'error';
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  error?: string;
};

export interface HealthEndpointOptions {
  pluginCount?: number;
  pluginMcpToolCount?: number;
  isDraining?: () => boolean;
  uptimeSeconds?: () => number;
  vectorHealth?: () => Promise<VectorHealth>;
  vectorServerHealth?: () => Promise<VectorServerHealth>;
  pluginStatuses?: () => UnifiedPluginStatus[] | Promise<UnifiedPluginStatus[]>;
  embeddingProviders?: EmbeddingProviderProbe;
  embeddingProviderSelection?: EmbeddingProviderSelection;
  embedderRuntime?: () => Promise<EmbedderRuntimeStatus>;
  vectorRuntime?: () => VectorRuntimeStatus;
  dbPing?: DbPing;
  diskPath?: string;
  diskUsage?: () => DiskHealth;
  memoryUsage?: () => NodeJS.MemoryUsage;
  entityCoverage?: () => EntityCoverageStats;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDbStatus(ping: DbPing = defaultDbPing): Promise<DbStatus> {
  try { return await ping(); }
  catch (error) { return { status: 'error', error: errorMessage(error) }; }
}

async function defaultDbPing(): Promise<DbStatus> {
  try {
    sqlite.prepare('SELECT 1 as ok').get();
    return { status: 'connected' };
  } catch (error) {
    return { status: 'error', error: errorMessage(error) };
  }
}

async function readVectorStatus(check = readVectorBackendHealth): Promise<VectorHealth> {
  try {
    const vector = await check();
    return { ...vector, collections: vector.collections ?? vector.engines };
  } catch (error) {
    return {
      status: 'down', engines: [], collections: [],
      checked_at: new Date().toISOString(), error: errorMessage(error),
    } as VectorHealth & { error: string };
  }
}

async function readPluginStatuses(read?: () => UnifiedPluginStatus[] | Promise<UnifiedPluginStatus[]>): Promise<UnifiedPluginStatus[]> {
  try { return await read?.() ?? []; }
  catch (error) { return [{ name: 'plugin-status', status: 'degraded', error: errorMessage(error) }]; }
}

function vectorAvailable(runtime: ReturnType<typeof getVectorRuntimeStatus>, vector: VectorHealth, vectorServer: VectorServerHealth): boolean {
  if (vectorServer.configured || runtime.vectorMode === 'proxied') return vectorServer.status === 'ok';
  if (runtime.vectorMode === 'disabled') return false;
  return vector.status !== 'down';
}

async function readHealthEmbedderStatus(options: HealthEndpointOptions): Promise<EmbedderRuntimeStatus> {
  if (options.embedderRuntime) return options.embedderRuntime();
  if (options.embeddingProviders || options.embeddingProviderSelection) return injectedEmbedderStatus(options);
  return readEmbedderRuntimeStatus();
}

function injectedEmbedderStatus(options: HealthEndpointOptions): EmbedderRuntimeStatus {
  const selection = options.embeddingProviderSelection ?? resolveEmbeddingProviderSelection();
  const runtime = getEmbedderRuntimeStatus();
  if (runtime.status !== 'unknown' && runtime.provider === selection.provider && !runtime.reason?.includes('FTS5-only')) return runtime;
  return { status: 'unknown', ...selection };
}

async function readSafeVectorServerHealth(read = readVectorServerHealth): Promise<VectorServerHealth> {
  try { return await read(); }
  catch (error) { return { configured: true, status: 'down', error: errorMessage(error) }; }
}

function installedPluginCount(): number {
  try { return scanPlugins().plugins.length; }
  catch { return 0; }
}

export function createHealthEndpoint(options: HealthEndpointOptions = {}) {
  return new Elysia().get('/health', async () => {
    if (options.isDraining?.()) {
      const healthStatus = 'down';
      return {
        status: 'draining', healthStatus, state: healthStatus,
        checked_at: new Date().toISOString(), server: MCP_SERVER_NAME,
        version: pkg.version, sandbox: sandboxLabel(), draining: true,
        subsystems: drainingSubsystems(),
      };
    }

    const uptimeSeconds = Number(options.uptimeSeconds?.() ?? process.uptime());
    const dbStatus = await readDbStatus(options.dbPing);
    const vector = await readVectorStatus(options.vectorHealth);
    const pluginItems = await readPluginStatuses(options.pluginStatuses);
    const vectorServer = await readSafeVectorServerHealth(options.vectorServerHealth);
    const pluginCount = options.pluginCount ?? (pluginItems.length || installedPluginCount());
    const pluginStatus = pluginItems.some((plugin) => plugin.status === 'degraded') ? 'degraded' : 'ok';
    const toolCount = mcpTools.length + (options.pluginMcpToolCount ?? 0);
    const vectorRuntime = options.vectorRuntime?.() ?? (options.vectorHealth
      ? { vectorMode: 'embedded' as const }
      : getVectorRuntimeStatus());
    const embedderStatus = await readHealthEmbedderStatus(options);
    const serviceUptime = Math.round(uptimeSeconds * 1000) / 1000;
    const vectorIsAvailable = embedderStatus.status === 'degraded' ? false : vectorAvailable(vectorRuntime, vector, vectorServer);
    const vectorStatus = vector.status === 'down' ? 'down' : embedderStatus.status === 'degraded' ? 'degraded' : vector.status;
    const entityCoverage = options.entityCoverage?.() ?? readEntityCoverageStats();
    const subsystems = await buildHealthSubsystems({
      dbStatus, vector, vectorServer, vectorRuntime, pluginStatus, pluginCount,
      toolCount, uptimeSeconds: serviceUptime, embeddingProviders: options.embeddingProviders,
      embeddingProviderSelection: options.embeddingProviderSelection, embedderStatus, entityCoverage,
    });
    const healthStatus = rollupHealthStatus(subsystems);

    return {
      status: healthRollupStatus(dbStatus, pluginStatus, vector, vectorServer, vectorRuntime),
      healthStatus, state: healthStatus, checked_at: new Date().toISOString(),
      server: MCP_SERVER_NAME,
      version: pkg.version,
      port: Number(PORT),
      sandbox: sandboxLabel(),
      uptime: serviceUptime,
      uptimeSeconds: serviceUptime,
      db: dbStatus.status,
      oracle: dbStatus.status === 'connected' ? 'connected' : 'degraded',
      dbStatus: dbStatus.status,
      vectorStatus,
      embedderStatus,
      ...(embedderStatus.reason ? { vectorReason: embedderStatus.reason } : {}),
      ...vectorRuntime,
      vectorAvailable: vectorIsAvailable,
      pluginStatus,
      mcpToolCount: toolCount,
      pluginCount,
      uptimeSecondsBreakdown: { seconds: serviceUptime },
      dbCheck: { ...dbStatus, path: DB_PATH },
      vector,
      vectorServer,
      memory: { fanoutReranking: memoryConfidenceRerankConfig(), consolidationWorker: sleepConsolidationStatus() },
      entities: { coverage: entityCoverage, backfillWorker: entityBackfillStatus() },
      mcp: { toolCount },
      plugins: { count: pluginCount, status: pluginStatus, items: pluginItems },
      subsystems,
    };
  }, {
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      description: 'Returns aggregate health status for process, database, vector index, and plugin systems.',
      summary: 'Server liveness, dependencies, and runtime counts',
    },
  });
}

export const healthEndpoint = createHealthEndpoint();
