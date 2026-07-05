import { and, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { indexingJobs, oracleDocuments, oracleFts } from '../db/schema.ts';
import { asOracleDb, type OracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import type { OracleDocument } from '../types.ts';
import { enqueueIndexJob } from './jobs.ts';

export type DocSnapshot = Map<string, { sourceFile: string; content: string | null }>;
export type ModelRegistry = Record<string, { collection: string }>;

export interface VectorQueueStats {
  queued: number;
  skipped: number;
  failed: number;
}

const REINDEX_REASON = 'superseded by indexer reindex';

export function snapshotActiveIndexerDocs(input: OracleDbInput, tenantId?: string): DocSnapshot {
  const db = asOracleDb(input);
  const rows = db.select({
    id: oracleDocuments.id,
    sourceFile: oracleDocuments.sourceFile,
    content: sql<string | null>`(
      SELECT GROUP_CONCAT(${oracleFts.content}, '\n')
      FROM ${oracleFts}
      WHERE ${oracleFts.id} = ${oracleDocuments.id}
    )`,
  })
    .from(oracleDocuments)
    .where(activeIndexerWhere(tenantId))
    .all();

  return new Map(rows.map((row) => [row.id, { sourceFile: row.sourceFile, content: row.content }]));
}

export function changedDocumentIds(before: DocSnapshot, documents: OracleDocument[]): Set<string> {
  const changed = new Set<string>();
  for (const doc of documents) {
    const prior = before.get(doc.id);
    if (!prior || prior.content !== doc.content) changed.add(doc.id);
  }
  return changed;
}

export function supersedeReplacedSourceDocs(
  input: OracleDbInput,
  documents: OracleDocument[],
  tenantId?: string,
): number {
  const db = asOracleDb(input);
  const bySource = new Map<string, string[]>();
  for (const doc of documents) {
    const ids = bySource.get(doc.source_file) ?? [];
    ids.push(doc.id);
    bySource.set(doc.source_file, ids);
  }

  let superseded = 0;
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
    superseded += stale.length;
  }
  return superseded;
}

export function enqueueVectorReindexJobs(
  input: OracleDbInput,
  documents: OracleDocument[],
  models: ModelRegistry,
  changedIds: Set<string>,
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
    const changed = changedIds.has(docId);
    for (const modelKey of modelKeys) {
      try {
        if (!needsVectorJob(db, docId, modelKey, changed)) {
          stats.skipped++;
          continue;
        }
        const jobs = enqueueIndexJob(db, { docId, modelKey, models });
        stats.queued += jobs.length;
        if (jobs.length === 0) stats.failed++;
      } catch {
        stats.failed++;
      }
    }
  }
  return stats;
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
    const row = db.get<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexing_jobs'`,
    );
    return row?.name === 'indexing_jobs';
  } catch {
    return false;
  }
}

function needsVectorJob(
  db: OracleDb,
  docId: string,
  modelKey: string,
  changed: boolean,
): boolean {
  const rows = db.select({ status: indexingJobs.status })
    .from(indexingJobs)
    .where(and(eq(indexingJobs.docId, docId), eq(indexingJobs.modelKey, modelKey)))
    .orderBy(desc(indexingJobs.createdAt))
    .all();
  if (changed) return !rows.some((row) => row.status === 'pending');
  return !rows.some((row) => row.status === 'pending'
    || row.status === 'claimed'
    || row.status === 'done');
}
