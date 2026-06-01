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
 *   GET  /vector/index/models  — available models + collection counts
 */

import { Elysia, t } from 'elysia';
import { Database } from 'bun:sqlite';
import { createVectorStore, getEmbeddingModels, getVectorStoreConfigByModel } from '../../vector/factory.ts';
import { DB_PATH } from '../../config.ts';
import type {
  EmbeddingProviderType,
  VectorDBType,
  VectorDocument,
  VectorStoreAdapter,
} from '../../vector/types.ts';

// ── In-memory status (no sqlite writes — avoids the disk I/O problem) ──

interface IndexJob {
  jobId: string;
  model: string;
  status: 'indexing' | 'completed' | 'error' | 'idle';
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  strategy?: RebuildStrategy;
}

let currentJob: IndexJob = {
  jobId: '',
  model: '',
  status: 'idle',
  current: 0,
  total: 0,
  startedAt: 0,
};

export type RebuildStrategy = 'replace' | 'delete-add';

export async function rebuildVectorCollection(
  store: VectorStoreAdapter,
  docs: VectorDocument[],
  batchSize: number,
  onProgress: (current: number) => void = () => {},
): Promise<{ strategy: RebuildStrategy }> {
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
}

// ── Endpoints ──────────────────────────────────────────────────────────

export const vectorIndexerEndpoints = new Elysia()

  // POST /vector/index/start
  .post('/vector/index/start', async ({ body, set }) => {
    if (currentJob.status === 'indexing') {
      set.status = 409;
      return { error: 'Indexing already in progress', job: currentJob };
    }

    const models = getEmbeddingModels();
    const key = body.model && models[body.model] ? body.model : 'bge-m3';
    const storeConfig = getVectorStoreConfigByModel(key);
    const batchSize = body.batchSize ?? (key === 'nomic' ? 100 : 50);

    const jobId = `vidx-${Date.now()}`;
    currentJob = {
      jobId,
      model: key,
      status: 'indexing',
      current: 0,
      total: 0,
      startedAt: Date.now(),
    };

    // Background indexing — fire and forget
    (async () => {
      let sqlite: Database | undefined;
      let store: VectorStoreAdapter | undefined;
      try {
        sqlite = new Database(DB_PATH, { readonly: true });

        const rows = sqlite.prepare(`
          SELECT d.id, d.type, GROUP_CONCAT(f.content, '\n') as content,
                 d.source_file, d.concepts, d.project, d.created_at
          FROM oracle_documents d
          JOIN oracle_fts f ON d.id = f.id
          GROUP BY d.id
          ORDER BY d.created_at DESC
        `).all() as Array<{
          id: string; type: string; content: string;
          source_file: string; concepts: string; project: string | null;
          created_at: string;
        }>;

        currentJob.total = rows.length;

        store = createVectorStore(storeConfig);
        const docs: VectorDocument[] = rows.map(row => ({
          id: row.id,
          document: row.content,
          metadata: {
            type: row.type,
            source_file: row.source_file,
            concepts: row.concepts,
            ...(row.project && { project: row.project }),
          },
        }));

        const rebuild = await rebuildVectorCollection(store, docs, batchSize, current => {
          currentJob.current = current;
        });

        currentJob.strategy = rebuild.strategy;
        currentJob.status = 'completed';
        currentJob.completedAt = Date.now();
      } catch (e) {
        currentJob.status = 'error';
        currentJob.error = e instanceof Error ? e.message : String(e);
        currentJob.completedAt = Date.now();
      } finally {
        try { await store?.close(); } catch {}
        sqlite?.close();
      }
    })();

    return {
      jobId,
      status: 'started',
      model: key,
      adapter: storeConfig.type,
      collection: storeConfig.collectionName,
      batchSize,
    };
  }, {
    body: t.Object({
      model: t.Optional(t.String()),
      batchSize: t.Optional(t.Number()),
    }),
    detail: {
      tags: ['vector-indexer'],
      summary: 'Start vector reindexing for a model',
    },
  })

  // GET /vector/index/status
  .get('/vector/index/status', () => {
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

  // GET /vector/index/models
  .get('/vector/index/models', async () => {
    const models = getEmbeddingModels();
    const result: Record<string, {
      collection: string;
      model: string;
      adapter: VectorDBType;
      provider: EmbeddingProviderType;
      count?: number;
    }> = {};

    for (const key of Object.keys(models)) {
      const storeConfig = getVectorStoreConfigByModel(key);
      const entry: {
        collection: string;
        model: string;
        adapter: VectorDBType;
        provider: EmbeddingProviderType;
        count?: number;
      } = {
        collection: storeConfig.collectionName ?? key,
        model: storeConfig.embeddingModel ?? key,
        adapter: storeConfig.type ?? 'lancedb',
        provider: storeConfig.embeddingProvider ?? 'ollama',
      };
      let store: ReturnType<typeof createVectorStore> | null = null;

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

    return { models: result };
  }, {
    detail: {
      tags: ['vector-indexer'],
      summary: 'Available embedding models and collection counts',
    },
  });
