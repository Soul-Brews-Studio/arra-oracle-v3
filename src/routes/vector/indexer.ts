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
import { createVectorStore, getEmbeddingModels } from '../../vector/factory.ts';
import { DB_PATH } from '../../config.ts';

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
}

let currentJob: IndexJob = {
  jobId: '',
  model: '',
  status: 'idle',
  current: 0,
  total: 0,
  startedAt: 0,
};

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
    const preset = models[key];
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

        const store = createVectorStore({
          type: 'lancedb',
          collectionName: preset.collection,
          embeddingProvider: 'ollama',
          embeddingModel: preset.model,
          ...(preset.dataPath && { dataPath: preset.dataPath }),
        });

        await store.connect();
        try { await store.deleteCollection(); } catch {}
        await store.ensureCollection();

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const docs = batch.map(row => ({
            id: row.id,
            document: row.content,
            metadata: {
              type: row.type,
              source_file: row.source_file,
              concepts: row.concepts,
              ...(row.project && { project: row.project }),
            },
          }));

          await store.addDocuments(docs);
          currentJob.current = i + batch.length;
        }

        await store.close();
        currentJob.status = 'completed';
        currentJob.completedAt = Date.now();
      } catch (e) {
        currentJob.status = 'error';
        currentJob.error = e instanceof Error ? e.message : String(e);
        currentJob.completedAt = Date.now();
      } finally {
        sqlite?.close();
      }
    })();

    return { jobId, status: 'started', model: key, batchSize };
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
    const result: Record<string, { collection: string; model: string; count?: number }> = {};

    for (const [key, preset] of Object.entries(models)) {
      const entry: { collection: string; model: string; count?: number } = {
        collection: preset.collection,
        model: preset.model,
      };

      try {
        const store = createVectorStore({
          type: 'lancedb',
          collectionName: preset.collection,
          embeddingProvider: 'ollama',
          embeddingModel: preset.model,
          ...(preset.dataPath && { dataPath: preset.dataPath }),
        });
        await store.connect();
        const stats = await store.getStats();
        entry.count = stats.count;
        await store.close();
      } catch {
        entry.count = 0;
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
