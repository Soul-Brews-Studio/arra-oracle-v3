import {
  ensureVectorStoreConnected,
  getEmbeddingModels,
  type EmbeddingModelConfig,
} from './factory.ts';
import { resolveEmbeddingProviderType } from './embedder-config.ts';

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

export type VectorFreshness = {
  status: 'fresh' | 'empty';
  totalIndexed: number;
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
};


export function attachVectorDashboardHealth(
  health: VectorBackendHealth,
  providers: Array<{ type: string; available: boolean; error?: string; detail?: string }> = [],
): VectorBackendHealth {
  const totalIndexed = health.engines.reduce((sum, engine) => sum + (engine.count || 0), 0);
  return {
    ...health,
    collections: health.collections ?? health.engines,
    providers: providers.map((provider) => ({
      type: provider.type,
      available: provider.available,
      status: provider.available ? 'green' : 'red',
      detail: provider.error ?? provider.detail,
    })),
    freshness: {
      status: totalIndexed > 0 ? 'fresh' : 'empty',
      totalIndexed,
    },
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

  const engines = await Promise.all(Object.entries(models).map(async ([key, preset]) => {
    const details = vectorEngineDetails(preset);
    try {
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
  return { status, engines, collections: engines, checked_at: new Date().toISOString() };
}
