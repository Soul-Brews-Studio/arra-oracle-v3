/**
 * Vector Indexer Endpoints — runs indexing inside the vector sidecar.
 *
 * Moves indexing out of the main server so LanceDB writes don't contend
 * with oracle.db reads/writes on the same process.  oracle.db is opened
 * READ-ONLY here (inherits ORACLE_VECTOR_READONLY=1 from the sidecar env).
 *
 * Endpoints (under /api prefix from vectorRoutes):
 *   POST /vector/index/start   — trigger reindex for a model
 *   GET  /vector/index/status  — current job status (poll)
 *   POST /vector/index/stop    — request current job stop
 *   GET  /vector/index/models  — available models + collection counts
 */

import { Elysia, t } from 'elysia';
import { getEmbeddingModels, getVectorStoreConfigByModel } from '../../vector/factory.ts';
import { loadVectorIndexDocuments, type VectorIndexSource } from './indexer-source.ts';
import { proxyVectorIndexer } from './indexer-proxy.ts';
import { localVectorOperations, type RebuildStrategy } from '../../server/vector-operations.ts';

// ── In-memory status (no sqlite writes — avoids the disk I/O problem) ──

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


export const rebuildVectorCollection = localVectorOperations.rebuildCollection.bind(localVectorOperations);

// ── Endpoints ──────────────────────────────────────────────────────────

export const vectorIndexerEndpoints = new Elysia()

  // POST /vector/index/start
  .post('/vector/index/start', async ({ body, set }) => {
    const remote = await proxyVectorIndexer('start', set, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (remote) return remote;

    if (currentJob.status === 'indexing' || currentJob.status === 'stopping') {
      set.status = 409;
      return { error: 'Indexing already in progress', job: currentJob };
    }

    const models = getEmbeddingModels();
    const modelKeys = body.model === 'all'
      ? Object.keys(models)
      : [body.model && models[body.model] ? body.model : 'bge-m3'];
    const firstKey = modelKeys[0] ?? 'bge-m3';
    const firstStoreConfig = getVectorStoreConfigByModel(firstKey);
    const batchSize = body.batchSize ?? 50;

    const jobId = `vidx-${Date.now()}`;
    stopRequestedJobId = null;
    currentJob = {
      jobId,
      model: body.model === 'all' ? 'all' : firstKey,
      models: modelKeys,
      status: 'indexing',
      current: 0,
      total: 0,
      startedAt: Date.now(),
    };

    // Background indexing — fire and forget
    (async () => {
      try {
        const loaded = loadVectorIndexDocuments({ source: body.source, repoRoot: body.repoRoot });
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
            try { await store?.close(); } catch {}
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
    })();

    return {
      jobId,
      status: 'started',
      model: currentJob.model,
      models: modelKeys,
      adapter: firstStoreConfig.type,
      collection: firstStoreConfig.collectionName,
      batchSize,
      source: body.source ?? 'auto',
    };
  }, {
    body: t.Object({
      model: t.Optional(t.String()),
      batchSize: t.Optional(t.Number()),
      source: t.Optional(t.String()),
      repoRoot: t.Optional(t.String()),
    }),
    detail: {
      tags: ['vector-indexer'],
      summary: 'Start vector reindexing for a model',
    },
  })

  // GET /vector/index/status
  .get('/vector/index/status', async ({ set }) => {
    const remote = await proxyVectorIndexer('status', set);
    if (remote) return remote;

    const elapsed = currentJob.startedAt
      ? (Date.now() - currentJob.startedAt) / 1000
      : 0;
    const docsPerSec = elapsed > 0 && currentJob.current > 0
      ? +(currentJob.current / elapsed).toFixed(1)
      : 0;
    const remaining = currentJob.total - currentJob.current;
    const eta = docsPerSec > 0 ? Math.ceil(remaining / docsPerSec) : 0;

    return {
      ...currentJob,
      docsPerSec,
      eta,
    };
  }, {
    detail: {
      tags: ['vector-indexer'],
      summary: 'Current indexing job status',
    },
  })

  // POST /vector/index/stop
  .post('/vector/index/stop', async ({ set }) => {
    const remote = await proxyVectorIndexer('stop', set, { method: 'POST' });
    if (remote) return remote;

    if (currentJob.status !== 'indexing') {
      return { status: currentJob.status, stopped: false, job: currentJob };
    }

    stopRequestedJobId = currentJob.jobId;
    currentJob.status = 'stopping';
    currentJob.error = 'Stop requested by operator';
    return { status: 'stopping', stopped: true, job: currentJob };
  }, {
    detail: {
      tags: ['vector-indexer'],
      summary: 'Request current vector indexing job stop',
    },
  })

  // GET /vector/index/models
  .get('/vector/index/models', async ({ set }) => {
    const remote = await proxyVectorIndexer('models', set);
    if (remote) return remote;

    return { models: await localVectorOperations.modelStats() };
  }, {
    detail: {
      tags: ['vector-indexer'],
      summary: 'Available embedding models and collection counts',
    },
  });
