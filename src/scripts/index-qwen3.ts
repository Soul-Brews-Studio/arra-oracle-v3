#!/usr/bin/env bun
/**
 * Index oracle knowledge with qwen3-embedding into a separate LanceDB collection.
 * Runs alongside the default nomic-embed-text collection.
 *
 * Usage: bun src/scripts/index-qwen3.ts
 *
 * Creates the `oracle_knowledge_qwen3_v2` LanceDB table.
 * (same LanceDB dir as default, different table name)
 */

import { createVectorStore, getEmbeddingModels } from '../vector/factory.ts';
import { Database } from 'bun:sqlite';
import { DB_PATH } from '../config.ts';
import { UNIVERSAL_PROJECT } from '../document-identity.ts';

const BATCH_SIZE = 50; // Smaller batches — qwen3 is slower per embedding
const PRESET = getEmbeddingModels().qwen3;

async function main() {
  console.log('=== Qwen3-Embedding Indexer ===');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Collection: ${PRESET.collection}`);
  console.log(`Model: ${PRESET.model}`);

  // Open oracle.db to read documents
  const db = new Database(DB_PATH, { readonly: true });
  const total = db.query('SELECT COUNT(*) as count FROM oracle_documents').get() as { count: number };
  console.log(`Documents: ${total.count}`);

  // Create LanceDB store with qwen3
  const store = createVectorStore({
    type: 'lancedb',
    collectionName: PRESET.collection,
    embeddingProvider: 'ollama',
    embeddingModel: PRESET.model,
  });

  await store.connect();

  // Fresh index
  try { await store.deleteCollection(); } catch {}
  await store.ensureCollection();

  // Read all docs (join oracle_documents + oracle_fts for content, GROUP BY to dedupe FTS chunks)
  const rows = db.query(`
    SELECT d.id, d.display_id, d.content_digest, d.type, GROUP_CONCAT(f.content, '\n') as content, d.source_file, d.concepts, d.project, d.created_at
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `).all() as Array<{
    id: string;
    display_id: string;
    content_digest: string;
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
        display_id: row.display_id,
        content_digest: row.content_digest,
        type: row.type,
        source_file: row.source_file,
        concepts: row.concepts,
        project: row.project || UNIVERSAL_PROJECT,
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
  db.close();
}

main().catch(e => {
  console.error('Indexer failed:', e);
  process.exit(1);
});
