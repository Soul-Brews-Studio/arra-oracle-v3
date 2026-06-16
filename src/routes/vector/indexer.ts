/**
 * Vector Indexer Endpoints — runs indexing inside the vector sidecar.
 *
 * Endpoints (mounted under /api):
 *   POST /vector/index/start   — trigger reindex for one/all models
 *   GET  /vector/index/status  — current job status
 *   POST /vector/index/stop    — request current job stop
 *   GET  /vector/index/models  — available models + collection counts
 */

import { Elysia, t } from 'elysia';
import {
  createVectorStoreForModel,
  getEmbeddingModels,
  getVectorStoreConfigByModel,
  type EmbeddingModelConfig,
} from '../../vector/factory.ts';
import type { VectorDocument, VectorStoreAdapter } from '../../vector/types.ts';
import { loadVectorIndexDocuments, type VectorIndexSource } from './indexer-source.ts';
import { proxyVectorIndexer } from './indexer-proxy.ts';
import { localVectorOperations } from '../../server/vector-operations.ts';
import type { RebuildStrategy } from '../../server/vector-operation-types.ts';

type VectorModelEntry = { collection: string; model: string; adapter: string; provider?: string; count?: number };

type StartBody = {
  model?: string;
  batchSize?: number;
  source?: string;
  repoRoot?: string;
};

export interface VectorModelsEndpointOptions {
  getModels?: () => Record<string, EmbeddingModelConfig>;
  createStore?: (preset: EmbeddingModelConfig) => Pick<VectorStoreAdapter, 'connect' | 'getStats' | 'close'>;
}

function providerFor(preset: EmbeddingModelConfig): string {
  return preset.provider ?? preset.embedder?.backend ?? 'ollama';
}

async function readVectorModels(options: VectorModelsEndpointOptions = {}) {
  const models = (options.getModels ?? getEmbeddingModels)();
  const createStore = options.createStore ?? createVectorStoreForModel;
  const result: Record<string, VectorModelEntry> = {};

  for (const [key, preset] of Object.entries(models)) {
    const entry: VectorModelEntry = {
      collection: preset.collection,
      model: preset.model,
      adapter: preset.adapter || 'lancedb',
      provider: providerFor(preset),
    };

    let store: Pick<VectorStoreAdapter, 'connect' | 'getStats' | 'close'> | undefined;
    try {
      store = createStore(preset);
      await store.connect();
      const stats = await store.getStats();
      entry.count = stats.count;
    } catch {
      entry.count = 0;
    } finally {
      await store?.close().catch(() => {});
    }

    result[key] = entry;
  }

  return { models: result };
}

export function createVectorModelEndpoints(options: VectorModelsEndpointOptions = {}) {
  const readModels = () => readVectorModels(options);
  const detail = {
    tags: ['vector-indexer'],
    summary: 'Available embedding models and collection counts',
  };

  return new Elysia()
    .get('/vector/index/models', readModels, { detail })
    .get('/vector/models', readModels, { detail: { ...detail, summary: 'Versioned vector model registry alias' } });
}

interface IndexJob {
  jobId: string;
  model: string;
  status: 'indexing' | 'stopping' | 'completed' | 'error' | 'idle' | 'stopped';
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  strategy?: RebuildStrategy;
  source?: Exclude<VectorIndexSource, 'auto'>;
  repoRoot?: string;
  models?: string[];
}

let currentJob: IndexJob = {
  jobId: '',
  model: '',
  status: 'idle',
  current: 0,
  total: 0,
  startedAt: 0,
};
let stopRequestedJobId: string | null = null;

export const rebuildVectorCollection = localVectorOperations.rebuildCollection.bind(localVectorOperations) as (
  store: VectorStoreAdapter,
  docs: VectorDocument[],
  batchSize: number,
  onProgress?: (current: number) => void,
) => Promise<{ strategy: RebuildStrategy }>;

async function runIndexJob(jobId: string, input: StartBody, modelKeys: string[], batchSize: number) {
  try {
    const loaded = loadVectorIndexDocuments({ source: input.source, repoRoot: input.repoRoot });
    currentJob.source = loaded.source;
    currentJob.repoRoot = loaded.repoRoot;
    currentJob.total = loaded.docs.length * modelKeys.length;

    for (const [modelIndex, key] of modelKeys.entries()) {
      if (stopRequestedJobId === jobId) break;
      const { store } = localVectorOperations.createStoreForModel(key);
      try {
        const offset = modelIndex * loaded.docs.length;
        const rebuild = await localVectorOperations.rebuildCollection(store, loaded.docs, batchSize, current => {
          currentJob.current = offset + current;
        });
        currentJob.strategy = rebuild.strategy;
      } finally {
        try { await store.close(); } catch {}
      }
    }

    if (stopRequestedJobId === jobId) {
      currentJob.status = 'stopped';
      currentJob.error = 'Stopped by operator';
    } else {
      currentJob.status = 'completed';
    }
    currentJob.completedAt = Date.now();
  } catch (e) {
    currentJob.status = 'error';
    currentJob.error = e instanceof Error ? e.message : String(e);
    currentJob.completedAt = Date.now();
  }
}

function jobStatus() {
  const elapsed = currentJob.startedAt ? (Date.now() - currentJob.startedAt) / 1000 : 0;
  const docsPerSec = elapsed > 0 && currentJob.current > 0 ? +(currentJob.current / elapsed).toFixed(1) : 0;
  const remaining = currentJob.total - currentJob.current;
  const eta = docsPerSec > 0 ? Math.ceil(remaining / docsPerSec) : 0;
  return { ...currentJob, docsPerSec, eta };
}

export const vectorIndexerEndpoints = new Elysia()
  .post('/vector/index/start', async ({ body, set }) => {
    const input = (body ?? {}) as StartBody;
    const remote = await proxyVectorIndexer('start', set, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (remote) return remote;

    if (currentJob.status === 'indexing' || currentJob.status === 'stopping') {
      set.status = 409;
      return { error: 'Indexing already in progress', job: currentJob };
    }

    const models = getEmbeddingModels();
    const modelKeys = input.model === 'all'
      ? Object.keys(models)
      : [input.model && models[input.model] ? input.model : 'bge-m3'];
    const firstKey = modelKeys[0] ?? 'bge-m3';
    const firstStoreConfig = getVectorStoreConfigByModel(firstKey);
    const batchSize = input.batchSize ?? 50;
    const jobId = `vidx-${Date.now()}`;

    stopRequestedJobId = null;
    currentJob = {
      jobId,
      model: input.model === 'all' ? 'all' : firstKey,
      models: modelKeys,
      status: 'indexing',
      current: 0,
      total: 0,
      startedAt: Date.now(),
    };

    void runIndexJob(jobId, input, modelKeys, batchSize);

    return {
      jobId,
      status: 'started',
      model: currentJob.model,
      models: modelKeys,
      adapter: firstStoreConfig.type ?? 'lancedb',
      collection: firstStoreConfig.collectionName ?? firstKey,
      batchSize,
      source: input.source ?? 'auto',
    };
  }, {
    body: t.Object({
      model: t.Optional(t.String()),
      batchSize: t.Optional(t.Number()),
      source: t.Optional(t.String()),
      repoRoot: t.Optional(t.String()),
    }),
    detail: { tags: ['vector-indexer'], summary: 'Start vector reindexing for a model' },
  })
  .get('/vector/index/status', async ({ set }) => {
    const remote = await proxyVectorIndexer('status', set);
    if (remote) return remote;
    return jobStatus();
  }, { detail: { tags: ['vector-indexer'], summary: 'Current indexing job status' } })
  .post('/vector/index/stop', async ({ set }) => {
    const remote = await proxyVectorIndexer('stop', set, { method: 'POST' });
    if (remote) return remote;
    if (currentJob.status !== 'indexing') return { status: currentJob.status, stopped: false, job: currentJob };
    stopRequestedJobId = currentJob.jobId;
    currentJob.status = 'stopping';
    currentJob.error = 'Stop requested by operator';
    return { status: 'stopping', stopped: true, job: currentJob };
  }, { detail: { tags: ['vector-indexer'], summary: 'Request current vector indexing job stop' } })
  .get('/vector/index/models', async ({ set }) => {
    const remote = await proxyVectorIndexer('models', set);
    if (remote) return remote;
    return { models: await localVectorOperations.modelStats() };
  }, { detail: { tags: ['vector-indexer'], summary: 'Available embedding models and collection counts' } })
  .get('/vector/models', async ({ set }) => {
    const remote = await proxyVectorIndexer('models', set);
    if (remote) return remote;
    return { models: await localVectorOperations.modelStats() };
  }, { detail: { tags: ['vector-indexer'], summary: 'Versioned vector model registry alias' } });
