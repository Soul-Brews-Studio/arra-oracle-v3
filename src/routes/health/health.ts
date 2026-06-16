import { Elysia } from 'elysia';
import { DB_PATH, PORT } from '../../config.ts';
import { MCP_SERVER_NAME } from '../../const.ts';
import { db, sqlite, settings } from '../../db/index.ts';
import { scanPlugins } from '../plugins/model.ts';
import { handleVectorHealth } from '../../server/vector-handlers.ts';
import { mcpTools } from '../../tools/mcp-manifest.ts';
import type { UnifiedPluginStatus } from '../../plugins/unified-loader.ts';
import pkg from '../../../package.json' with { type: 'json' };

type VectorHealth = Awaited<ReturnType<typeof handleVectorHealth>>;
type DbStatus = { status: 'connected' } | { status: 'error'; error: string };

export interface HealthEndpointOptions {
  pluginCount?: number;
  pluginMcpToolCount?: number;
  isDraining?: () => boolean;
  uptimeSeconds?: () => number;
  vectorHealth?: () => Promise<VectorHealth>;
  pluginStatuses?: () => UnifiedPluginStatus[] | Promise<UnifiedPluginStatus[]>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readDbStatus(): DbStatus {
  try {
    db.select({ key: settings.key }).from(settings).limit(1).all();
    sqlite.prepare('SELECT 1 as ok').get();
    return { status: 'connected' };
  } catch (error) {
    return { status: 'error', error: errorMessage(error) };
  }
}

async function readVectorStatus(check = handleVectorHealth): Promise<VectorHealth> {
  try {
    return await check();
  } catch (error) {
    return {
      status: 'down',
      engines: [],
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
        draining: true,
      };
    }

  const uptimeSeconds = Number(options.uptimeSeconds?.() ?? process.uptime());
  const dbStatus = readDbStatus();
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
      summary: 'Server liveness, dependencies, and runtime counts',
    },
  });
}

export const healthEndpoint = createHealthEndpoint();
