import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { indexingJobs, oracleDocuments, vectorIndexManifest } from '../db/schema.ts';
import { asOracleDb, type OracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import type { OracleDocument } from '../types.ts';
import { enqueueIndexJob } from './jobs.ts';
import { vectorContentHash } from './vector-index-manifest.ts';
import { loadCanonicalVectorDocumentFromDb } from './vector-source.ts';

export type ModelRegistry = Record<string, { collection: string }>;

export interface VectorQueueStats {
  queued: number;
  skipped: number;
  failed: number;
}

const REINDEX_REASON = 'superseded by indexer reindex';

export function supersedeReplacedSourceDocs(
  input: OracleDbInput,
  documents: OracleDocument[],
  models: ModelRegistry,
  tenantId?: string,
): string[] {
  const db = asOracleDb(input);
  const bySource = new Map<string, string[]>();
  for (const doc of documents) {
    const ids = bySource.get(doc.source_file) ?? [];
    ids.push(doc.id);
    bySource.set(doc.source_file, ids);
  }

  const staleIds: string[] = [];
  const now = Date.now();
  for (const [sourceFile, currentIds] of bySource) {
    const stale = activeIndexerIdsForSource(db, sourceFile, currentIds, tenantId);
    if (stale.length === 0) continue;
    const successorId = currentIds[0];
    db.update(oracleDocuments)
      .set({ supersededBy: successorId, supersededAt: now, supersededReason: REINDEX_REASON })
      .where(and(
        inArray(oracleDocuments.id, stale),
        isNull(oracleDocuments.supersededBy),
        isNull(oracleDocuments.supersededAt),
      ))
      .run();
    staleIds.push(...stale);
  }
  enqueueVectorDeleteJobs(db, staleIds, models);
  return staleIds;
}

export function enqueueVectorDeleteJobs(input: OracleDbInput, docIds: string[], models: ModelRegistry): number {
  const db = asOracleDb(input);
  let queued = 0;
  for (const docId of [...new Set(docIds)]) {
    for (const modelKey of Object.keys(models)) {
      const manifest = db.select({ id: vectorIndexManifest.id }).from(vectorIndexManifest)
        .where(and(eq(vectorIndexManifest.chunkId, docId), eq(vectorIndexManifest.modelKey, modelKey))).get();
      if (!manifest) continue;
      queued += enqueueIndexJob(db, { docId, contentHash: `delete:${docId}`, operation: 'delete', modelKey, models }).length;
    }
  }
  return queued;
}

/**
 * Reconcile fresh SQLite/FTS chunks into hash-keyed vector jobs.
 *
 * No parser-text comparison is used. The canonical persisted vector payload is
 * hashed after `storeDocuments()` so FTS enrichment, metadata and daemon input
 * are the same bytes. A matching manifest is the only successful-vector proof.
 */
export function enqueueVectorReindexJobs(
  input: OracleDbInput,
  documents: OracleDocument[],
  models: ModelRegistry,
): VectorQueueStats {
  const db = asOracleDb(input);
  const modelKeys = Object.keys(models);
  const docIds = [...new Set(documents.map((doc) => doc.id))];
  const stats: VectorQueueStats = { queued: 0, skipped: 0, failed: 0 };
  if (docIds.length === 0 || modelKeys.length === 0) return stats;
  if (!hasIndexingJobsTable(db)) {
    stats.failed = docIds.length * modelKeys.length;
    return stats;
  }

  for (const docId of docIds) {
    const vectorDoc = loadCanonicalVectorDocumentFromDb(db, docId);
    if (!vectorDoc) {
      stats.failed += modelKeys.length;
      continue;
    }
    const contentHash = vectorContentHash(vectorDoc);
    for (const modelKey of modelKeys) {
      try {
        if (!needsVectorJob(db, docId, modelKey, contentHash)) {
          stats.skipped++;
          continue;
        }
        const jobs = enqueueIndexJob(db, { docId, contentHash, modelKey, models });
        stats.queued += jobs.length;
        if (jobs.length === 0) stats.failed++;
      } catch {
        stats.failed++;
      }
    }
  }
  return stats;
}

/** Reconcile all canonical rows, used by the former direct-write cron command. */
export function enqueueCanonicalVectorJobs(
  input: OracleDbInput,
  docIds: string[],
  models: ModelRegistry,
): VectorQueueStats {
  return enqueueVectorReindexJobs(input, docIds.map((id) => ({ id } as OracleDocument)), models);
}

function activeIndexerIdsForSource(
  db: OracleDb,
  sourceFile: string,
  currentIds: string[],
  tenantId?: string,
): string[] {
  if (currentIds.length === 0) return [];
  const rows = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(
      eq(oracleDocuments.sourceFile, sourceFile),
      notInArray(oracleDocuments.id, currentIds),
      activeIndexerWhere(tenantId),
    ))
    .all();
  return rows.map((row) => row.id);
}

function activeIndexerWhere(tenantId?: string) {
  return and(
    or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy))!,
    isNull(oracleDocuments.supersededBy),
    isNull(oracleDocuments.supersededAt),
    tenantId ? eq(oracleDocuments.tenantId, tenantId) : undefined,
  )!;
}

function hasIndexingJobsTable(db: OracleDb): boolean {
  try {
    const row = db.select({ name: sql<string>`name` })
      .from(sql`sqlite_master`)
      .where(sql`type = 'table' AND name = 'indexing_jobs'`)
      .get();
    return row?.name === 'indexing_jobs';
  } catch {
    return false;
  }
}

function needsVectorJob(
  db: OracleDb,
  docId: string,
  modelKey: string,
  contentHash: string,
): boolean {
  const manifest = db.select({ contentHash: vectorIndexManifest.contentHash })
    .from(vectorIndexManifest)
    .where(and(eq(vectorIndexManifest.chunkId, docId), eq(vectorIndexManifest.modelKey, modelKey)))
    .get();
  if (manifest?.contentHash === contentHash) return false;

  const inFlight = db.select({ status: indexingJobs.status })
    .from(indexingJobs)
    .where(and(
      eq(indexingJobs.docId, docId),
      eq(indexingJobs.modelKey, modelKey),
      eq(indexingJobs.contentHash, contentHash),
      eq(indexingJobs.operation, 'upsert'),
    ))
    .all();
  return !inFlight.some((row) => row.status === 'pending' || row.status === 'claimed');
}
