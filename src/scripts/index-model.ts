#!/usr/bin/env bun
/** Generic embedding model indexer with incremental chunk-hash support. */

import { createVectorStoreForModel, EMBEDDING_MODELS } from '../vector/factory.ts';
import { createDatabase, oracleDocuments } from '../db/index.ts';
import { count } from 'drizzle-orm';
import { DB_PATH } from '../config.ts';
import { formatIndexProgress, normalizeBatchSize } from './indexer-progress.ts';
import {
  applyVectorIndexPlan,
  loadVectorIndexManifest,
  planVectorIndex,
  writeVectorIndexManifest,
  type VectorIndexPlan,
} from '../indexer/vector-index-manifest.ts';
import type { VectorDocument } from '../vector/types.ts';

const args = process.argv.slice(2);
const modelKey = args.find((arg) => !arg.startsWith('--'));
const flags = new Set(args.filter((arg) => arg.startsWith('--')));

if (!modelKey || !EMBEDDING_MODELS[modelKey] || flags.has('--help')) {
  console.error('Usage: bun src/scripts/index-model.ts <model> [--incremental] [--dry-run] [--force]');
  console.error(`Available models: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
  process.exit(flags.has('--help') ? 0 : 1);
}

const selectedModelKey = modelKey;
const preset = EMBEDDING_MODELS[selectedModelKey];
const BATCH_SIZE = normalizeBatchSize(process.env.ORACLE_EMBED_BATCH_SIZE, 50);
const dryRun = flags.has('--dry-run');
const force = flags.has('--force');

interface DbVectorRow {
  id: string;
  tenant_id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string;
  project: string | null;
  created_at: number;
}

async function main() {
  console.log(`=== ${selectedModelKey} Indexer ===`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Collection: ${preset.collection}`);
  console.log(`Model: ${preset.model}`);
  console.log(`Adapter: ${preset.adapter || 'lancedb'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Mode: ${force ? 'force rebuild' : 'incremental'}${dryRun ? ' dry-run' : ''}`);

  const { db, sqlite } = createDatabase(DB_PATH);
  const [{ total: docCount }] = db.select({ total: count() }).from(oracleDocuments).all();
  const rows = loadRows(sqlite);
  const docs = rows.map(vectorDoc);
  const previous = loadVectorIndexManifest(db, selectedModelKey);
  const plan = planVectorIndex(docs, previous, selectedModelKey, { force });
  const startTime = Date.now();

  console.log(`Documents: ${docCount}`);
  console.log(`Chunks: ${plan.total}; changed: ${plan.changedDocs.length}; stale: ${plan.staleIds.length}; skipped: ${plan.skipped}`);

  if (dryRun) {
    printSummary(rows, plan, { embedded: plan.changedDocs.length, errors: 0, startTime, dryRun, force });
    sqlite.close();
    return;
  }

  const store = createVectorStoreForModel(preset);
  await store.connect();

  try {
    const applied = await applyVectorIndexPlan(store, plan, {
      batchSize: BATCH_SIZE,
      replaceBaseline: previous.size === 0 || force,
      onProgress: (indexed, total, action) => logProgress(action === 'replaced' ? 'Rebuilt' : 'Embedded', indexed, total, startTime),
    });
    writeVectorIndexManifest(db, plan);
    printSummary(rows, plan, { embedded: applied.embedded, errors: 0, startTime, dryRun, force });
  } finally {
    await store.close();
    sqlite.close();
  }
}

function loadRows(sqlite: ReturnType<typeof createDatabase>['sqlite']): DbVectorRow[] {
  return sqlite.prepare(`
    SELECT d.id, d.tenant_id, d.type, GROUP_CONCAT(f.content, '\n') as content,
      d.source_file, d.concepts, d.project, d.created_at
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `).all() as DbVectorRow[];
}

function vectorDoc(row: DbVectorRow): VectorDocument {
  return {
    id: row.id,
    document: row.content,
    metadata: {
      type: row.type,
      source_file: row.source_file,
      concepts: row.concepts,
      tenant_id: row.tenant_id,
      ...(row.project && { project: row.project }),
    },
  };
}

function logProgress(label: string, indexed: number, total: number, startTime: number): void {
  const progress = formatIndexProgress({ indexed, total, startTimeMs: startTime });
  console.log(`  ${label} ${indexed}/${total} chunks — ${progress.rate}/s — ETA ${progress.eta}s`);
}

function printSummary(
  rows: DbVectorRow[],
  plan: VectorIndexPlan,
  result: { embedded: number; errors: number; startTime: number; dryRun: boolean; force: boolean },
): void {
  const durationMs = Date.now() - result.startTime;
  const summary = {
    scanned_files: new Set(rows.map((row) => row.source_file)).size,
    total_chunks: plan.total,
    skipped: result.force ? 0 : plan.skipped,
    embedded: result.embedded,
    deleted: plan.staleIds.length,
    errors: result.errors,
    dry_run: result.dryRun,
    force: result.force,
    duration_ms: durationMs,
  };
  console.log('\n=== Done ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => {
  console.error('Indexer failed:', e);
  process.exit(1);
});
