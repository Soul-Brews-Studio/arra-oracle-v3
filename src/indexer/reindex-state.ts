import type Database from 'bun:sqlite';
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

export function snapshotActiveIndexerDocs(sqlite: Database, tenantId?: string): DocSnapshot {
  const params: string[] = [];
  const tenantClause = tenantId ? 'AND d.tenant_id = ?' : '';
  if (tenantId) params.push(tenantId);
  const rows = sqlite.prepare(`
    SELECT d.id, d.source_file AS sourceFile,
      (SELECT GROUP_CONCAT(f.content, '\n') FROM oracle_fts f WHERE f.id = d.id) AS content
    FROM oracle_documents d
    WHERE (d.created_by = 'indexer' OR d.created_by IS NULL)
      AND d.superseded_by IS NULL
      AND d.superseded_at IS NULL
      ${tenantClause}
  `).all(...params) as Array<{ id: string; sourceFile: string; content: string | null }>;

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
  sqlite: Database,
  documents: OracleDocument[],
  tenantId?: string,
): number {
  const bySource = new Map<string, string[]>();
  for (const doc of documents) {
    const ids = bySource.get(doc.source_file) ?? [];
    ids.push(doc.id);
    bySource.set(doc.source_file, ids);
  }

  let superseded = 0;
  const now = Date.now();
  for (const [sourceFile, currentIds] of bySource) {
    const stale = activeIndexerIdsForSource(sqlite, sourceFile, currentIds, tenantId);
    if (stale.length === 0) continue;
    const successorId = currentIds[0];
    const update = sqlite.prepare(`
      UPDATE oracle_documents
      SET superseded_by = ?, superseded_at = ?, superseded_reason = ?
      WHERE id = ? AND superseded_by IS NULL AND superseded_at IS NULL
    `);
    sqlite.exec('BEGIN');
    try {
      for (const id of stale) {
        update.run(successorId, now, REINDEX_REASON, id);
        superseded++;
      }
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  return superseded;
}

export function enqueueVectorReindexJobs(
  sqlite: Database,
  documents: OracleDocument[],
  models: ModelRegistry,
  changedIds: Set<string>,
): VectorQueueStats {
  const modelKeys = Object.keys(models);
  const docIds = [...new Set(documents.map((doc) => doc.id))];
  const stats: VectorQueueStats = { queued: 0, skipped: 0, failed: 0 };
  if (docIds.length === 0 || modelKeys.length === 0) return stats;
  if (!hasIndexingJobsTable(sqlite)) {
    stats.failed = docIds.length * modelKeys.length;
    return stats;
  }

  for (const docId of docIds) {
    const changed = changedIds.has(docId);
    for (const modelKey of modelKeys) {
      try {
        if (!needsVectorJob(sqlite, docId, modelKey, changed)) {
          stats.skipped++;
          continue;
        }
        const jobs = enqueueIndexJob(sqlite, { docId, modelKey, models });
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
  sqlite: Database,
  sourceFile: string,
  currentIds: string[],
  tenantId?: string,
): string[] {
  if (currentIds.length === 0) return [];
  const notIn = currentIds.map(() => '?').join(',');
  const params: string[] = [sourceFile, ...currentIds];
  const tenantClause = tenantId ? 'AND tenant_id = ?' : '';
  if (tenantId) params.push(tenantId);
  const rows = sqlite.prepare(`
    SELECT id FROM oracle_documents
    WHERE source_file = ?
      AND id NOT IN (${notIn})
      AND (created_by = 'indexer' OR created_by IS NULL)
      AND superseded_by IS NULL
      AND superseded_at IS NULL
      ${tenantClause}
  `).all(...params) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function hasIndexingJobsTable(sqlite: Database): boolean {
  try {
    const row = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'indexing_jobs'",
    ).get() as { name: string } | undefined;
    return row?.name === 'indexing_jobs';
  } catch {
    return false;
  }
}

function needsVectorJob(
  sqlite: Database,
  docId: string,
  modelKey: string,
  changed: boolean,
): boolean {
  const rows = sqlite.prepare(`
    SELECT status FROM indexing_jobs
    WHERE doc_id = ? AND model_key = ?
    ORDER BY created_at DESC
  `).all(docId, modelKey) as Array<{ status: string }>;
  if (changed) return !rows.some((row) => row.status === 'pending');
  return !rows.some((row) => row.status === 'pending'
    || row.status === 'claimed'
    || row.status === 'done');
}
