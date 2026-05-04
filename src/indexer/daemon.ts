/**
 * arra-indexer daemon entrypoint — Elysia (M3, ported from alpha's Hono).
 *
 * Wires the real adapters (SQLite db, OllamaEmbeddings, LanceDB) into the
 * pure M2 worker loop, exposes the M3 HTTP API as an Elysia plugin, and
 * handles graceful shutdown on SIGTERM/SIGINT.
 *
 * Run:
 *   bun src/indexer/daemon.ts
 *
 * Listens on 127.0.0.1:47779 by default (override via INDEXER_PORT env).
 *
 * Design: ψ/lab/indexer-cli/DESIGN.md
 */

import Database from 'bun:sqlite';
import { Elysia } from 'elysia';
import { DB_PATH, LANCEDB_DIR } from '../config.ts';
import { createVectorStore, getEmbeddingModels } from '../vector/factory.ts';
import { runWorker, type WorkerEvent } from './worker.ts';
import { daemonApiPlugin, makeEventBus } from '../routes/indexer-daemon/index.ts';

const PORT = parseInt(process.env.INDEXER_PORT || '47779', 10);
const HOST = process.env.INDEXER_HOST || '127.0.0.1';

export async function startDaemon(): Promise<void> {
  const db = new Database(DB_PATH);
  // Ensure WAL so concurrent readers (arra-oracle-v3) don't block writes.
  db.exec('PRAGMA journal_mode = WAL');

  const models = getEmbeddingModels();
  const eventBus = makeEventBus<WorkerEvent>();
  let shuttingDown = false;

  // Resolve doc text via the FTS5 mirror table — same content arra_learn writes.
  const getDocText = (docId: string): string | null => {
    const row = db
      .query<{ content: string }, [string]>('SELECT content FROM oracle_fts WHERE id = ?')
      .get(docId);
    return row?.content ?? null;
  };

  // Embed via the existing factory — produces a model-aware OllamaEmbeddings.
  // Lazy per model so we don't spin up unused embedders.
  const stores = new Map<string, ReturnType<typeof createVectorStore>>();
  const getStore = async (modelKey: string, collection: string) => {
    let s = stores.get(modelKey);
    if (!s) {
      s = createVectorStore({
        type: 'lancedb',
        dataPath: LANCEDB_DIR,
        collectionName: collection,
        embeddingProvider: 'ollama',
        embeddingModel: modelKey,
      });
      await s.connect();
      await s.ensureCollection();
      stores.set(modelKey, s);
    }
    return s;
  };

  const embed = async (modelKey: string, text: string): Promise<number[]> => {
    const preset = models[modelKey];
    if (!preset) throw new Error(`Unknown model_key: ${modelKey}`);
    const store = await getStore(modelKey, preset.collection);
    const embedder = (store as { embedder?: { embed: (texts: string[], type?: 'query' | 'passage') => Promise<number[][]> } }).embedder;
    if (!embedder) throw new Error(`No embedder on store for ${modelKey}`);
    const [vector] = await embedder.embed([text], 'passage');
    return vector;
  };

  const upsertVector = async (collection: string, docId: string, vector: number[]): Promise<void> => {
    const entry = Object.entries(models).find(([, m]) => m.collection === collection);
    if (!entry) throw new Error(`No registered model has collection: ${collection}`);
    const [modelKey] = entry;
    const store = await getStore(modelKey, collection);
    await store.addDocuments([{ id: docId, document: '', metadata: { id: docId, indexed_at: Date.now() } }]);
    // TODO: extend VectorStoreAdapter with `upsert(id, vector, metadata)`
    // that doesn't re-embed. For now we accept the extra Ollama call.
    void vector;
  };

  const workerPromises: Promise<unknown>[] = [];
  for (const modelKey of Object.keys(models)) {
    const p = runWorker(modelKey, {
      db,
      getDocText,
      embed,
      upsertVector,
      isShuttingDown: () => shuttingDown,
      onEvent: eventBus.publish,
      pollIntervalMs: 1000,
    });
    workerPromises.push(p);
    console.log(`[arra-indexer] worker started for model: ${modelKey}`);
  }

  const app = new Elysia()
    .onError(({ error, set }) => {
      const msg = (error as { message?: string })?.message ?? String(error);
      set.status = 500;
      return { error: msg };
    })
    .use(
      daemonApiPlugin({
        db,
        models,
        isShuttingDown: () => shuttingDown,
        requestShutdown: () => { shuttingDown = true; },
        subscribe: eventBus.subscribe,
      }),
    )
    .listen({ hostname: HOST, port: PORT });

  console.log(`[arra-indexer] listening on http://${HOST}:${PORT}`);
  console.log(`[arra-indexer] models: ${Object.keys(models).join(', ')}`);

  const shutdown = async (signal: string) => {
    console.log(`[arra-indexer] ${signal} — draining…`);
    shuttingDown = true;
    await app.stop();
    // Workers exit on next loop tick. Give them up to 5s of in-flight grace.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([Promise.all(workerPromises), timeout]);
    db.close();
    console.log(`[arra-indexer] stopped.`);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.main) {
  startDaemon().catch((err) => {
    console.error('[arra-indexer] fatal:', err);
    process.exit(1);
  });
}
