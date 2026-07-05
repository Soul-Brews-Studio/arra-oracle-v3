import { DB_PATH } from '../../config.ts';
import { sqlite } from '../../db/index.ts';
import { resolveEmbeddingProviderType } from '../../vector/embedder-config.ts';
import { getDetectedEmbeddingProviders, type DetectedEmbeddingProvider } from '../../vector/provider-detection.ts';
import type { VectorBackendHealth } from '../../vector/health.ts';
import type { VectorRuntimeStatus } from '../../vector/runtime-status.ts';
import type { VectorServerHealth } from './vector-server.ts';

type DbStatus = { status: 'connected' } | { status: 'error'; error: string };
type CanonicalSubsystemName = 'backend' | 'database' | 'fts' | 'vector' | 'embedder' | 'mcp' | 'plugins';
export type HealthStatusEnum = 'healthy' | 'starting' | 'degraded' | 'down';
export type EmbeddingProviderDetection = { checkedAt?: string; providers: DetectedEmbeddingProvider[] };
export type EmbeddingProviderProbe = () => Promise<EmbeddingProviderDetection>;

export type HealthSubsystem = {
  status: HealthStatusEnum;
  label: string;
  detail: string;
  critical: boolean;
  checkedAt?: string;
  data?: Record<string, unknown>;
};

type CanonicalHealthSubsystems = Record<CanonicalSubsystemName, HealthSubsystem>;
export type HealthSubsystems = CanonicalHealthSubsystems & {
  db: HealthSubsystem;
  plugin: HealthSubsystem;
};

function err(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export async function buildHealthSubsystems(input: {
  dbStatus: DbStatus;
  vector: VectorBackendHealth;
  vectorServer: VectorServerHealth;
  vectorRuntime: VectorRuntimeStatus;
  pluginStatus: 'ok' | 'degraded';
  pluginCount: number;
  toolCount: number;
  uptimeSeconds: number;
  embeddingProviders?: EmbeddingProviderProbe;
}): Promise<HealthSubsystems> {
  return withAliases({
    backend: backendSubsystem(input.uptimeSeconds),
    database: databaseSubsystem(input.dbStatus),
    fts: ftsSubsystem(input.dbStatus),
    vector: vectorSubsystem(input.vector, input.vectorServer, input.vectorRuntime),
    embedder: await embedderSubsystem(input.embeddingProviders),
    mcp: mcpSubsystem(input.toolCount),
    plugins: pluginSubsystem(input.pluginStatus, input.pluginCount),
  });
}

export function drainingSubsystems(): HealthSubsystems {
  const item = (label: string) => down(label, 'server is draining requests');
  return withAliases({
    backend: item('backend reachable'), database: item('database writable'),
    fts: item('FTS healthy'), vector: item('vector backend'),
    embedder: item('embedder reachable'), mcp: item('MCP launchable'),
    plugins: item('plugins loaded'),
  });
}

export function rollupHealthStatus(subsystems: HealthSubsystems): HealthStatusEnum {
  const values = Object.values(subsystems);
  if (values.some((item) => item.critical && item.status === 'down')) return 'down';
  if (values.some((item) => item.critical && item.status === 'starting')) return 'starting';
  if (values.some((item) => item.status !== 'healthy')) return 'degraded';
  return 'healthy';
}

function withAliases(subsystems: CanonicalHealthSubsystems): HealthSubsystems {
  return { ...subsystems, db: subsystems.database, plugin: subsystems.plugins };
}

function backendSubsystem(uptimeSeconds: number): HealthSubsystem {
  return {
    status: 'healthy', label: 'backend reachable', critical: true,
    detail: `HTTP API responding; uptime ${Math.round(uptimeSeconds)}s`,
    data: { uptimeSeconds },
  };
}

function databaseSubsystem(dbStatus: DbStatus): HealthSubsystem {
  if (dbStatus.status !== 'connected') return down('database writable', dbStatus.error, { path: DB_PATH });
  try {
    sqlite.exec('SAVEPOINT oracle_health_write');
    sqlite.prepare("UPDATE settings SET updated_at = updated_at WHERE key = '__oracle_health_probe__'").run();
    sqlite.exec('ROLLBACK TO oracle_health_write');
    sqlite.exec('RELEASE oracle_health_write');
    return healthy('database writable', `SQLite connected and writable at ${DB_PATH}`, { path: DB_PATH, writable: true });
  } catch (error) {
    try { sqlite.exec('ROLLBACK TO oracle_health_write'); sqlite.exec('RELEASE oracle_health_write'); } catch {}
    return down('database writable', `SQLite write probe failed: ${err(error)}`, { path: DB_PATH, writable: false });
  }
}

function ftsSubsystem(dbStatus: DbStatus): HealthSubsystem {
  if (dbStatus.status !== 'connected') return down('FTS healthy', 'database is unavailable');
  try {
    const docs = count('oracle_documents');
    const indexed = count('oracle_fts');
    const missing = Math.max(0, docs - indexed);
    const status = docs > 0 && indexed === 0 ? 'degraded' : 'healthy';
    return {
      status, label: 'FTS healthy', critical: status === 'healthy',
      detail: docs === 0 ? 'FTS5 table ready; no documents yet' : `FTS5 indexed ${indexed}/${docs} documents`,
      data: { indexed, documents: docs, missing },
    };
  } catch (error) {
    return down('FTS healthy', `FTS5 check failed: ${err(error)}`);
  }
}

function vectorSubsystem(vector: VectorBackendHealth, server: VectorServerHealth, runtime: VectorRuntimeStatus): HealthSubsystem {
  const configuredProxy = server.configured || runtime.vectorMode === 'proxied';
  if (configuredProxy) {
    if (server.status === 'ok') return healthy('vector backend', `vector proxy reachable at ${server.url ?? runtime.vectorUrl ?? 'configured proxy'}`, { ...server });
    return down('vector backend', `configured vector proxy unreachable: ${server.error ?? server.status}`, { ...server });
  }
  if (runtime.vectorMode === 'disabled') return degraded('vector backend', `degraded: FTS-only (${runtime.vectorDisabledReason ?? 'vector disabled'})`);
  if (vector.status === 'ok') return healthy('vector backend', `${vector.engines.length} vector collection(s) available`, { engines: vector.engines.length });
  if (vector.status === 'degraded') return { status: 'degraded', label: 'vector backend', critical: false, detail: 'some vector collections are unavailable; FTS fallback remains active', data: { engines: vector.engines.length } };
  return degraded('vector backend', `degraded: FTS-only (${vector.engines[0]?.error ?? 'no vector collections available'})`);
}

async function embedderSubsystem(read?: EmbeddingProviderProbe): Promise<HealthSubsystem> {
  const probe = read ?? (() => getDetectedEmbeddingProviders(false, { timeoutMs: 750 }));
  const selected = resolveEmbeddingProviderType();
  if (selected === 'none') return degraded('embedder reachable', 'degraded: FTS-only (embedder disabled; ORACLE_EMBEDDER=none)');
  const lookup = selected === 'local' ? 'ollama' : selected;
  try {
    const detection = await probe();
    const provider = detection.providers.find((item) => item.type === lookup);
    if (provider?.available) return healthy('embedder reachable', `${selected} available`, { provider: selected, models: provider.models });
    return down('embedder reachable', `${selected} unavailable: ${provider?.error ?? 'not configured'}`, { provider: selected, checkedAt: detection.checkedAt });
  } catch (error) {
    return down('embedder reachable', `embedder probe failed: ${err(error)}`, { provider: selected });
  }
}

function mcpSubsystem(toolCount: number): HealthSubsystem {
  return toolCount > 0
    ? healthy('MCP launchable', `${toolCount} MCP tool(s) registered`, { toolCount })
    : down('MCP launchable', 'no MCP tools registered', { toolCount });
}

function pluginSubsystem(status: 'ok' | 'degraded', count: number): HealthSubsystem {
  return status === 'ok'
    ? healthy('plugins loaded', `${count} plugin(s) loaded`, { count })
    : { status: 'degraded', label: 'plugins loaded', critical: false, detail: `${count} plugin(s); at least one degraded`, data: { count } };
}

function count(table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function healthy(label: string, detail: string, data?: Record<string, unknown>): HealthSubsystem {
  return { status: 'healthy', label, critical: true, detail, data };
}

function down(label: string, detail: string, data?: Record<string, unknown>): HealthSubsystem {
  return { status: 'down', label, critical: true, detail, data };
}

function degraded(label: string, detail: string): HealthSubsystem {
  return { status: 'degraded', label, critical: false, detail };
}
