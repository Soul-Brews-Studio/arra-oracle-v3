import {
  ensureVectorStoreConnected,
  getEmbeddingModels,
  type EmbeddingModelConfig,
} from './factory.ts';
import { resolveEmbeddingProviderType } from './embedder-config.ts';
import { Database } from 'bun:sqlite';
import { DB_PATH } from '../config.ts';
import { isVectorSectionEnabled } from './config.ts';
import { localNativeVectorDisabledReason, localVectorIndexMissingReason } from './cpu-capabilities.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import type { HealthStatus, RegisteredVectorService } from './service-registry.ts';
import { withYieldingTimeout } from '../util/yielding-timeout.ts';

export type VectorBackendEngine = {
  key: string;
  model: string;
  collection: string;
  adapter: string;
  embeddingProvider: string;
  connectionStatus: 'connected' | 'error';
  count: number;
  ok: boolean;
  error?: string;
};

export type VectorProviderHealth = {
  type: string;
  status: 'green' | 'red';
  available: boolean;
  detail?: string;
};

export type VectorStorageHealth = {
  adapter: string;
  status: 'green' | 'red';
  healthy: number;
  total: number;
  detail?: string;
};

export type VectorServiceHealth = RegisteredVectorService & {
  status: 'green' | 'yellow' | 'red';
  available: boolean;
  health: HealthStatus;
};

export type VectorFreshness = {
  status: 'fresh' | 'empty' | 'stale';
  totalIndexed: number;
  sourceDocs?: number;
  docsPending?: number;
  docsExtra?: number;
  lastIndexed?: string;
};

export type VectorBackendHealth = {
  status: 'ok' | 'degraded' | 'down';
  engines: VectorBackendEngine[];
  collections?: VectorBackendEngine[];
  checked_at: string;
  providers?: VectorProviderHealth[];
  freshness?: VectorFreshness;
  services?: VectorServiceHealth[];
  storage?: VectorStorageHealth[];
};


export function attachVectorDashboardHealth(
  health: VectorBackendHealth,
  providers: Array<{ type: string; available: boolean; error?: string; detail?: string }> = [],
  services: VectorServiceHealth[] = [],
): VectorBackendHealth {
  return {
    ...health,
    collections: health.collections ?? health.engines,
    providers: providers.map((provider) => ({
      type: provider.type,
      available: provider.available,
      status: provider.available ? 'green' : 'red',
      detail: provider.error ?? provider.detail,
    })),
    freshness: health.freshness ?? buildVectorFreshness(health.engines),
    services: health.services ?? services,
    storage: health.storage ?? buildVectorStorageHealth(health.engines),
  };
}

export function buildVectorServiceHealth(
  services: RegisteredVectorService[],
  health: Map<string, HealthStatus>,
): VectorServiceHealth[] {
  return services.map((service) => {
    const serviceHealth = health.get(service.name) ?? { status: 'unknown' as const, checkedAt: new Date().toISOString() };
    return {
      ...service,
      available: serviceHealth.status === 'up',
      status: serviceHealth.status === 'up' ? 'green' : serviceHealth.status === 'down' ? 'red' : 'yellow',
      health: serviceHealth,
    };
  });
}

export function buildVectorStorageHealth(
  engines: Array<Pick<VectorBackendEngine, 'adapter' | 'ok' | 'error'>>,
): VectorStorageHealth[] {
  const byAdapter = new Map<string, { healthy: number; total: number; errors: string[] }>();
  for (const engine of engines) {
    const adapter = engine.adapter || 'unknown';
    const entry = byAdapter.get(adapter) ?? { healthy: 0, total: 0, errors: [] };
    entry.total += 1;
    if (engine.ok) entry.healthy += 1;
    else if (engine.error) entry.errors.push(engine.error);
    byAdapter.set(adapter, entry);
  }
  return Array.from(byAdapter.entries()).map(([adapter, entry]) => ({
    adapter,
    healthy: entry.healthy,
    total: entry.total,
    status: entry.healthy === entry.total ? 'green' as const : 'red' as const,
    ...(entry.errors.length && { detail: entry.errors[0] }),
  }));
}

export function buildVectorFreshness(
  engines: Array<Pick<VectorBackendEngine, 'count'>>,
  source?: { docs?: number; lastIndexed?: string },
): VectorFreshness {
  const counts = engines.map((engine) => engine.count || 0);
  const totalIndexed = counts.reduce((sum, count) => sum + count, 0);
  const maxIndexed = counts.reduce((max, count) => Math.max(max, count), 0);
  const docsPending = source?.docs === undefined ? undefined : Math.max(0, source.docs - maxIndexed);
  const docsExtra = source?.docs === undefined ? undefined : Math.max(0, maxIndexed - source.docs);
  const hasDrift = (docsPending ?? 0) > 0 || (docsExtra ?? 0) > 0;
  const status = totalIndexed === 0 ? 'empty' : hasDrift ? 'stale' : 'fresh';
  return {
    status,
    totalIndexed,
    ...(source?.docs !== undefined && { sourceDocs: source.docs, docsPending, docsExtra }),
    ...(source?.lastIndexed && { lastIndexed: source.lastIndexed }),
  };
}

function vectorEngineDetails(preset: EmbeddingModelConfig) {
  return {
    adapter: preset.adapter || 'lancedb',
    embeddingProvider: preset.embedder?.backend ?? resolveEmbeddingProviderType(),
  };
}

export async function readVectorBackendHealth(): Promise<VectorBackendHealth> {
  const timeout = parseInt(process.env.ORACLE_VECTOR_HEALTH_TIMEOUT || '2000', 10);
  const models = getEmbeddingModels();

  const vectorEnabled = isVectorSectionEnabled();
  const engines = await Promise.all(Object.entries(models).map(async ([key, preset]) => {
    const details = vectorEngineDetails(preset);
    try {
      const unavailable = !vectorEnabled
        ? 'vector section disabled'
        : localNativeVectorDisabledReason(details.adapter) || localVectorIndexMissingReason({
          type: details.adapter,
          dataPath: preset.dataPath,
          collectionName: preset.collection,
        });
      if (unavailable) throw new Error(unavailable);
      const store = await ensureVectorStoreConnected(key);
      const stats = await withYieldingTimeout(store.getStats(), timeout);
      return {
        key,
        model: preset.model,
        collection: preset.collection,
        ...details,
        connectionStatus: 'connected' as const,
        count: stats.count,
        ok: true,
      };
    } catch (error) {
      return {
        key,
        model: preset.model,
        collection: preset.collection,
        ...details,
        connectionStatus: 'error' as const,
        count: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  const okCount = engines.filter((engine) => engine.ok).length;
  const status = okCount === engines.length ? 'ok' : okCount === 0 ? 'down' : 'degraded';
  return {
    status,
    engines,
    collections: engines,
    checked_at: new Date().toISOString(),
    freshness: buildVectorFreshness(engines, readVectorSourceDocumentStats()),
    storage: buildVectorStorageHealth(engines),
  };
}

export function readVectorSourceDocumentStats(dbPath = DB_PATH): { docs?: number; lastIndexed?: string } {
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const tenantId = currentTenantId();
    const row = tenantId
      ? db.query<{ docs: number; lastIndexed: string | null }, [string]>(`
          SELECT COUNT(DISTINCT d.id) AS docs, MAX(d.indexed_at) AS lastIndexed
          FROM oracle_documents d
          JOIN oracle_fts f ON f.id = d.id
          WHERE d.tenant_id = ?
        `).get(tenantId)
      : db.query<{ docs: number; lastIndexed: string | null }, []>(`
          SELECT COUNT(DISTINCT d.id) AS docs, MAX(d.indexed_at) AS lastIndexed
          FROM oracle_documents d
          JOIN oracle_fts f ON f.id = d.id
        `).get();
    return {
      docs: row?.docs ?? 0,
      ...(row?.lastIndexed && { lastIndexed: String(row.lastIndexed) }),
    };
  } catch {
    return {};
  } finally {
    db?.close();
  }
}
