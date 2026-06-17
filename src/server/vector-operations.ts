import { and, eq, inArray } from 'drizzle-orm';
import { db, oracleDocuments } from '../db/index.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import {
  createVectorStore,
  ensureVectorStoreConnected,
  getEmbeddingModels,
  getVectorStoreConfigByModel,
} from '../vector/factory.ts';
import { localNativeVectorDisabledReason, localVectorIndexMissingReason } from '../vector/cpu-capabilities.ts';
import { selectVectorSearchModelKeys } from '../vector/model-selection.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { SearchResult } from './types.ts';
import type { VectorIndexModelInfo, VectorOperations, VectorSearchInput } from './vector-operation-types.ts';

function cosineDistanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

function modelKeys(model?: string): Array<string | undefined> {
  return selectVectorSearchModelKeys(model, getEmbeddingModels());
}

async function searchOneModel(input: VectorSearchInput, model: string | undefined): Promise<SearchResult[]> {
  const modelName = model || 'bge-m3';
  const client = await ensureVectorStoreConnected(model);
  const limit = input.limit ?? 10;
  const isMulti = input.model === 'multi';
  const whereFilter = input.type && input.type !== 'all' ? { type: input.type } : undefined;
  const vectorRows = await client.query(input.query, isMulti ? limit : limit * 2, whereFilter);

  if (!vectorRows.ids || vectorRows.ids.length === 0) return [];

  const tenantId = currentTenantId();
  const idFilter = inArray(oracleDocuments.id, vectorRows.ids);
  const docFilter = tenantId ? and(idFilter, eq(oracleDocuments.tenantId, tenantId)) : idFilter;
  const rows = db.select({ id: oracleDocuments.id, project: oracleDocuments.project })
    .from(oracleDocuments)
    .where(docFilter)
    .all();
  const projectMap = new Map<string, string | null>();
  rows.forEach(r => projectMap.set(r.id, r.project));

  const resolvedProject = input.project?.toLowerCase() ?? null;
  return vectorRows.ids
    .map((id: string, i: number) => {
      const distance = vectorRows.distances?.[i] || 0;
      const docProject = projectMap.get(id);
      return {
        id,
        type: vectorRows.metadatas?.[i]?.type || 'unknown',
        content: vectorRows.documents?.[i] || '',
        source_file: vectorRows.metadatas?.[i]?.source_file || '',
        concepts: [],
        project: docProject,
        source: 'vector' as const,
        score: cosineDistanceToSimilarity(distance),
        distance,
        model: modelName,
      };
    })
    .filter(r => (!tenantId || projectMap.has(r.id)) && (!resolvedProject || r.project === resolvedProject || r.project === null));
}

function dedupeMultiModel(results: SearchResult[]): SearchResult[] {
  const bestByDoc = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = bestByDoc.get(result.id);
    if (!existing || (result.score || 0) > (existing.score || 0)) {
      bestByDoc.set(result.id, {
        ...result,
        score: Math.min(1, (result.score || 0) + (existing ? 0.05 : 0)),
        source: existing ? 'hybrid' as const : result.source,
      });
    }
  }
  return Array.from(bestByDoc.values());
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}

export const localVectorOperations: VectorOperations = {
  async search(input) {
    const settled = await Promise.allSettled(modelKeys(input.model).map(model => searchOneModel(input, model)));
    const results: SearchResult[] = [];
    const failures: unknown[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(...result.value);
      else failures.push(result.reason);
    }
    if (results.length === 0 && failures.length > 0) throw failures[0];
    return { results: input.model === 'multi' ? dedupeMultiModel(results) : results };
  },

  async stats(timeoutMs = parseInt(process.env.ORACLE_CHROMA_TIMEOUT || '5000', 10)) {
    const models = getEmbeddingModels();
    const engines: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }> = [];

    await Promise.all(Object.entries(models).map(async ([key, preset]) => {
      try {
        const cfg = getVectorStoreConfigByModel(key);
        const unavailable = localNativeVectorDisabledReason(cfg.type) || localVectorIndexMissingReason(cfg);
        if (unavailable) {
          engines.push({ key, model: preset.model, collection: preset.collection, count: 0, enabled: false });
          return;
        }
        const store = await ensureVectorStoreConnected(key);
        const stats = await withTimeout(store.getStats(), timeoutMs);
        engines.push({ key, model: preset.model, collection: preset.collection, count: stats.count, enabled: true });
      } catch {
        engines.push({ key, model: preset.model, collection: preset.collection, count: 0, enabled: false });
      }
    }));

    const primary = engines.find(e => e.key === 'bge-m3') || engines[0];
    return {
      vector: {
        enabled: primary?.enabled ?? false,
        count: primary?.count ?? 0,
        collection: primary?.collection ?? 'oracle_knowledge_bge_m3',
      },
      vectors: engines,
    };
  },

  async health(timeoutMs = parseInt(process.env.ORACLE_VECTOR_HEALTH_TIMEOUT || '2000', 10)) {
    const models = getEmbeddingModels();
    const engines: Array<{ key: string; model: string; collection: string; ok: boolean; error?: string }> = [];

    await Promise.all(Object.entries(models).map(async ([key, preset]) => {
      try {
        const cfg = getVectorStoreConfigByModel(key);
        const unavailable = localNativeVectorDisabledReason(cfg.type) || localVectorIndexMissingReason(cfg);
        if (unavailable) {
          engines.push({ key, model: preset.model, collection: preset.collection, ok: false, error: unavailable });
          return;
        }
        const store = await ensureVectorStoreConnected(key);
        await withTimeout(store.getStats(), timeoutMs);
        engines.push({ key, model: preset.model, collection: preset.collection, ok: true });
      } catch (error) {
        engines.push({ key, model: preset.model, collection: preset.collection, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }));

    const okCount = engines.filter(e => e.ok).length;
    const status: 'ok' | 'degraded' | 'down' = okCount === engines.length ? 'ok' : okCount === 0 ? 'down' : 'degraded';
    return { status, engines, checked_at: new Date().toISOString() };
  },

  async modelStats() {
    const models = getEmbeddingModels();
    const result: Record<string, VectorIndexModelInfo> = {};
    for (const key of Object.keys(models)) {
      const storeConfig = getVectorStoreConfigByModel(key);
      const entry: VectorIndexModelInfo = {
        collection: storeConfig.collectionName ?? key,
        model: storeConfig.embeddingModel ?? key,
        adapter: storeConfig.type ?? 'lancedb',
        provider: storeConfig.embeddingProvider ?? 'ollama',
      };
      let store: VectorStoreAdapter | null = null;
      try {
        store = createVectorStore(storeConfig);
        await store.connect();
        const stats = await store.getStats();
        entry.count = stats.count;
      } catch {
        entry.count = 0;
      } finally {
        try { await store?.close(); } catch {}
      }
      result[key] = entry;
    }
    return result;
  },

  async rebuildCollection(store, docs, batchSize, onProgress = () => {}) {
    await store.connect();

    if (typeof store.replaceDocuments === 'function') {
      await store.replaceDocuments(docs);
      onProgress(docs.length);
      return { strategy: 'replace' };
    }

    try { await store.deleteCollection(); } catch {}
    await store.ensureCollection();

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      await store.addDocuments(batch);
      onProgress(Math.min(i + batch.length, docs.length));
    }

    return { strategy: 'delete-add' };
  },

  createStoreForModel(model) {
    const config = getVectorStoreConfigByModel(model);
    return { store: createVectorStore(config), config };
  },
};
