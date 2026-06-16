import { ensureVectorStoreConnected, getEmbeddingModels } from './factory.ts';

export type VectorBackendEngine = {
  key: string;
  model: string;
  collection: string;
  adapter?: string;
  count: number;
  ok: boolean;
  error?: string;
};

export type VectorBackendHealth = {
  status: 'ok' | 'degraded' | 'down';
  engines: VectorBackendEngine[];
  checked_at: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function readVectorBackendHealth(): Promise<VectorBackendHealth> {
  const timeout = parseInt(process.env.ORACLE_VECTOR_HEALTH_TIMEOUT || '2000', 10);
  const models = getEmbeddingModels();
  const engines: VectorBackendEngine[] = [];

  await Promise.all(Object.entries(models).map(async ([key, preset]) => {
    try {
      const store = await ensureVectorStoreConnected(key);
      const stats = await withTimeout(store.getStats(), timeout);
      engines.push({
        key,
        model: preset.model,
        collection: preset.collection,
        adapter: preset.adapter,
        count: stats.count,
        ok: true,
      });
    } catch (error) {
      engines.push({
        key,
        model: preset.model,
        collection: preset.collection,
        adapter: preset.adapter,
        count: 0,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  const okCount = engines.filter((engine) => engine.ok).length;
  const status = okCount === engines.length ? 'ok' : okCount === 0 ? 'down' : 'degraded';
  return { status, engines, checked_at: new Date().toISOString() };
}
