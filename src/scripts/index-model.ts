#!/usr/bin/env bun
/** Generic embedding model indexer with incremental chunk-hash support. */

import { createVectorStoreForModel, EMBEDDING_MODELS } from '../vector/factory.ts';
import { createDatabase, oracleDocuments } from '../db/index.ts';
import { count } from 'drizzle-orm';
import { DB_PATH } from '../config.ts';
import { formatIndexProgress, normalizeBatchSize } from './indexer-progress.ts';
import {
  loadVectorIndexManifest,
  planVectorIndex,
  writeVectorIndexManifest,
  type VectorIndexPlan,
} from '../indexer/vector-index-manifest.ts';
import type { VectorDocument, VectorStoreAdapter } from '../vector/types.ts';

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
    const embedded = await applyVectorPlan(store, plan, previous.size === 0 || force, startTime);
    writeVectorIndexManifest(db, plan);
    printSummary(rows, plan, { embedded, errors: 0, startTime, dryRun, force });
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

async function applyVectorPlan(
  store: VectorStoreAdapter,
  plan: VectorIndexPlan,
  replaceBaseline: boolean,
  startTime: number,
): Promise<number> {
  if (replaceBaseline || (plan.staleIds.length > 0 && !store.deleteDocuments)) {
    if (!store.replaceDocuments) throw new Error(`Vector adapter '${store.name}' does not support replaceDocuments()`);
    await replaceAll(store, plan.docs, startTime);
    return plan.docs.length;
  }

  if (plan.staleIds.length > 0) await store.deleteDocuments?.(plan.staleIds);
  const changedIds = plan.changedDocs.map((doc) => doc.id);
  if (changedIds.length > 0) await store.deleteDocuments?.(changedIds);
  await addChanged(store, plan.changedDocs, plan.total, startTime);
  return plan.changedDocs.length;
}

async function replaceAll(store: VectorStoreAdapter, docs: VectorDocument[], startTime: number): Promise<void> {
  if (docs.length === 0) {
    await store.replaceDocuments?.([]);
    return;
  }
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    if (i === 0) await store.replaceDocuments?.(batch);
    else await store.addDocuments(batch);
    logProgress('Rebuilt', i + batch.length, docs.length, startTime);
  }
}

async function addChanged(store: VectorStoreAdapter, docs: VectorDocument[], total: number, startTime: number): Promise<void> {
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE);
    await store.addDocuments(batch);
    logProgress('Embedded', i + batch.length, total, startTime);
  }
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
