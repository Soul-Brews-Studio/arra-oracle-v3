#!/usr/bin/env bun
/**
 * Generic embedding model indexer.
 * Reads model config from EMBEDDING_MODELS registry in factory.ts.
 *
 * Usage:
 *   bun src/scripts/index-model.ts bge-m3
 *   bun src/scripts/index-model.ts qwen3
 *   bun src/scripts/index-model.ts nomic
 */

import { createVectorStore, EMBEDDING_MODELS } from '../vector/factory.ts';
import { createDatabase, oracleDocuments } from '../db/index.ts';
import { count } from 'drizzle-orm';
import { DB_PATH } from '../config.ts';

const modelKey = process.argv[2];

if (!modelKey || !EMBEDDING_MODELS[modelKey]) {
  console.error(`Usage: bun src/scripts/index-model.ts <model>`);
  console.error(`Available models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
  process.exit(1);
}

const preset = EMBEDDING_MODELS[modelKey];

// Larger models get smaller batches to avoid OOM / timeouts
const BATCH_SIZE = modelKey === 'nomic' ? 100 : 50;

async function main() {
  console.log(`=== ${modelKey} Indexer ===`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Collection: ${preset.collection}`);
  console.log(`Model: ${preset.model}`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  // Use Drizzle for structured queries, raw sqlite only for FTS5 joins
  const { db, sqlite } = createDatabase(DB_PATH);
  const [{ total: docCount }] = db.select({ total: count() }).from(oracleDocuments).all();
  console.log(`Documents: ${docCount}`);

  const dbType = (process.env.ORACLE_VECTOR_DB || 'lancedb') as any;
  const embedProvider = (process.env.ORACLE_EMBEDDING_PROVIDER || 'ollama') as any;
  const embedModel = embedProvider === 'openai'
    ? (process.env.ORACLE_EMBEDDING_MODEL || 'text-embedding-3-small')
    : preset.model;

  const store = createVectorStore({
    type: dbType,
    collectionName: preset.collection,
    embeddingProvider: embedProvider,
    embeddingModel: embedModel,
    ...(dbType === 'lancedb' && preset.dataPath && { dataPath: preset.dataPath }),
  });

  await store.connect();

  // Fresh index
  try { await store.deleteCollection(); } catch {}
  await store.ensureCollection();

  // FTS5 join requires raw SQL — Drizzle doesn't support virtual tables
  const rows = sqlite.prepare(`
    SELECT d.id, d.type, GROUP_CONCAT(f.content, '\n') as content, d.source_file, d.concepts, d.project, d.created_at
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `).all() as Array<{
    id: string;
    type: string;
    content: string;
    source_file: string;
    concepts: string;
    project: string | null;
    created_at: string;
  }>;

  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
  let indexed = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

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

    try {
      await store.addDocuments(docs);
      indexed += docs.length;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (indexed / Number(elapsed)).toFixed(1);
      const eta = ((rows.length - indexed) / Number(rate)).toFixed(0);
      console.log(`  Batch ${batchNum}/${totalBatches} — ${indexed}/${rows.length} docs — ${rate}/s — ETA ${eta}s`);
    } catch (e) {
      errors++;
      console.error(`  Batch ${batchNum} FAILED:`, e instanceof Error ? e.message : String(e));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const stats = await store.getStats();

  console.log('\n=== Done ===');
  console.log(`Indexed: ${stats.count} docs`);
  console.log(`Errors: ${errors} batches`);
  console.log(`Time: ${totalTime}s`);

  await store.close();
  sqlite.close();
}

main().catch(e => {
  console.error('Indexer failed:', e);
  process.exit(1);
});
