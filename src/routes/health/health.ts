import { Elysia, t } from 'elysia';
import { DB_PATH, PORT } from '../../config.ts';
import { MCP_SERVER_NAME } from '../../const.ts';
import { sqlite } from '../../db/index.ts';
import { scanPlugins } from '../plugins/model.ts';
import { readVectorBackendHealth } from '../../vector/health.ts';
import { mcpTools } from '../../tools/mcp-manifest.ts';
import type { UnifiedPluginStatus } from '../../plugins/unified-loader.ts';
import { sandboxLabel } from '../../runtime/sandbox-label.ts';
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

const HealthVectorEngineSchema = t.Object({
  key: t.String(),
  model: t.String(),
  collection: t.String(),
  adapter: t.Optional(t.String()),
  embeddingProvider: t.Optional(t.String()),
  connectionStatus: t.Optional(t.Union([t.Literal('connected'), t.Literal('error')])),
  count: t.Optional(t.Number()),
  ok: t.Boolean(),
  error: t.Optional(t.String()),
});

const HealthVectorSchema = t.Object({
  status: t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')]),
  checked_at: t.String(),
  engines: t.Array(HealthVectorEngineSchema),
  collections: t.Optional(t.Array(HealthVectorEngineSchema)),
  error: t.Optional(t.String()),
});

const HealthResponseSchema = t.Object({
  status: t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('draining')]),
  server: t.String(),
  version: t.String(),
  port: t.Optional(t.Number()),
  sandbox: t.Optional(t.String()),
  oracle: t.Optional(t.Union([t.Literal('connected'), t.Literal('degraded')])),
  uptimeSeconds: t.Optional(t.Number()),
  dbStatus: t.Optional(t.Union([t.Literal('connected'), t.Literal('error')])),
  vectorStatus: t.Optional(t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')])),
  pluginStatus: t.Optional(t.Union([t.Literal('ok'), t.Literal('degraded')])),
  mcpToolCount: t.Optional(t.Number()),
  pluginCount: t.Optional(t.Number()),
  uptime: t.Optional(t.Object({
    seconds: t.Number(),
  })),
  uptimeSecondsBreakdown: t.Optional(t.Object({
    seconds: t.Number(),
  })),
  db: t.Optional(t.Object({
    status: t.Union([t.Literal('connected'), t.Literal('error')]),
    path: t.String(),
    error: t.Optional(t.String()),
  })),
  dbCheck: t.Optional(t.Object({
    status: t.Union([t.Literal('connected'), t.Literal('error')]),
    path: t.Optional(t.String()),
    error: t.Optional(t.String()),
  })),
  vector: t.Optional(HealthVectorSchema),
  mcp: t.Optional(t.Object({ toolCount: t.Number() })),
  plugins: t.Optional(t.Object({
    count: t.Number(),
    status: t.Union([t.Literal('ok'), t.Literal('degraded')]),
    items: t.Array(t.Object({
      name: t.String(),
      status: t.Union([t.Literal('ok'), t.Literal('degraded')]),
      error: t.Optional(t.String()),
    })),
  })),
  draining: t.Optional(t.Boolean()),
});

export interface HealthEndpointOptions {
  pluginCount?: number;
  pluginMcpToolCount?: number;
  isDraining?: () => boolean;
  uptimeSeconds?: () => number;
  vectorHealth?: () => Promise<VectorHealth>;
  pluginStatuses?: () => UnifiedPluginStatus[] | Promise<UnifiedPluginStatus[]>;
  dbPing?: DbPing;
  diskPath?: string;
  diskUsage?: () => DiskHealth;
  memoryUsage?: () => NodeJS.MemoryUsage;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDbStatus(ping: DbPing = defaultDbPing): Promise<DbStatus> {
  try {
    return await ping();
  } catch (error) {
    return { status: 'error', error: errorMessage(error) };
  }
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
      status: 'down',
      engines: [],
      collections: [],
      checked_at: new Date().toISOString(),
      error: errorMessage(error),
    } as VectorHealth & { error: string };
  }
}

function installedPluginCount(): number {
  try {
    return scanPlugins().plugins.length;
  } catch {
    return 0;
  }
}

export function createHealthEndpoint(options: HealthEndpointOptions = {}) {
  return new Elysia().get('/health', async ({ set }) => {
    if (options.isDraining?.()) {
      set.status = 503;
      return {
        status: 'draining',
        server: MCP_SERVER_NAME,
        version: pkg.version,
        sandbox: sandboxLabel(),
        draining: true,
      };
    }

    const uptimeSeconds = Number(options.uptimeSeconds?.() ?? process.uptime());
    const dbStatus = await readDbStatus(options.dbPing);
    const vector = await readVectorStatus(options.vectorHealth);
    const pluginItems = await options.pluginStatuses?.() ?? [];
    const pluginCount = options.pluginCount ?? (pluginItems.length || installedPluginCount());
    const pluginStatus = pluginItems.some((plugin) => plugin.status === 'degraded') ? 'degraded' : 'ok';
    const toolCount = mcpTools.length + (options.pluginMcpToolCount ?? 0);

    const serviceUptime = Math.round(uptimeSeconds * 1000) / 1000;
    return {
      status: dbStatus.status === 'connected' ? 'ok' : 'degraded',
      server: MCP_SERVER_NAME,
      version: pkg.version,
      port: Number(PORT),
      sandbox: sandboxLabel(),
      uptime: serviceUptime,
      uptimeSeconds: serviceUptime,
      db: dbStatus.status,
      oracle: dbStatus.status === 'connected' ? 'connected' : 'error',
      dbStatus: dbStatus.status,
      vectorStatus: vector.status,
      pluginStatus,
      mcpToolCount: toolCount,
      pluginCount,
      uptimeSecondsBreakdown: { seconds: serviceUptime },
      dbCheck: { ...dbStatus, path: DB_PATH },
      vector,
      mcp: { toolCount },
      plugins: { count: pluginCount, status: pluginStatus, items: pluginItems },
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
