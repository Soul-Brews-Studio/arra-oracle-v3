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

export type VectorFreshness = {
  status: 'fresh' | 'empty' | 'stale';
  totalIndexed: number;
  sourceDocs?: number;
  docsPending?: number;
  lastIndexed?: string;
};

export type VectorBackendHealth = {
  status: 'ok' | 'degraded' | 'down';
  engines: VectorBackendEngine[];
  collections?: VectorBackendEngine[];
  checked_at: string;
  providers?: VectorProviderHealth[];
  freshness?: VectorFreshness;
  storage?: VectorStorageHealth[];
};


export function attachVectorDashboardHealth(
  health: VectorBackendHealth,
  providers: Array<{ type: string; available: boolean; error?: string; detail?: string }> = [],
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
    storage: health.storage ?? buildVectorStorageHealth(health.engines),
  };
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
  const status = totalIndexed === 0 ? 'empty' : docsPending && docsPending > 0 ? 'stale' : 'fresh';
  return {
    status,
    totalIndexed,
    ...(source?.docs !== undefined && { sourceDocs: source.docs, docsPending }),
    ...(source?.lastIndexed && { lastIndexed: source.lastIndexed }),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
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
      const stats = await withTimeout(store.getStats(), timeout);
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
    freshness: buildVectorFreshness(engines, readSourceDocumentStats()),
    storage: buildVectorStorageHealth(engines),
  };
}

function readSourceDocumentStats(): { docs?: number; lastIndexed?: string } {
  let db: Database | undefined;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const tenantId = currentTenantId();
    const row = tenantId
      ? db.query<{ docs: number; lastIndexed: string | null }, [string]>(`
          SELECT COUNT(DISTINCT id) AS docs, MAX(indexed_at) AS lastIndexed
          FROM oracle_documents WHERE tenant_id = ?
        `).get(tenantId)
      : db.query<{ docs: number; lastIndexed: string | null }, []>(`
          SELECT COUNT(DISTINCT id) AS docs, MAX(indexed_at) AS lastIndexed
          FROM oracle_documents
        `).get();
    return {
      docs: row?.docs ?? 0,
      ...(row?.lastIndexed && { lastIndexed: row.lastIndexed }),
    };
  } catch {
    return {};
  } finally {
    db?.close();
  }
}
