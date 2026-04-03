/**
 * Stats and vector stats handlers
 *
 * Extracted from handlers.ts for maintainability.
 */

import { eq, sql } from 'drizzle-orm';
import { db, oracleDocuments, indexingStatus } from '../db/index.ts';
import { ensureVectorStoreConnected, getEmbeddingModels } from '../vector/factory.ts';

/**
 * Get database statistics
 */
export function handleStats(dbPath: string) {
  const totalDocs = getDocumentCount();
  const byTypeResults = getCountByType();
  const { lastIndexedDate, indexAgeHours } = getLastIndexedInfo();
  const idxStatus = getIndexingStatus();
  const uniqueByType = getUniqueFilesByType();

  return {
    total: totalDocs,
    by_type: byTypeResults.reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {}),
    by_type_files: uniqueByType.reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {}),
    last_indexed: lastIndexedDate,
    index_age_hours: indexAgeHours ? Math.round(indexAgeHours * 10) / 10 : null,
    is_stale: indexAgeHours ? indexAgeHours > 24 : true,
    is_indexing: idxStatus.is_indexing,
    indexing_progress: idxStatus.is_indexing ? {
      current: idxStatus.progress_current,
      total: idxStatus.progress_total,
      percent: idxStatus.progress_total > 0
        ? Math.round((idxStatus.progress_current / idxStatus.progress_total) * 100)
        : 0
    } : null,
    indexing_completed_at: idxStatus.completed_at,
    database: dbPath
  };
}

function getDocumentCount(): number {
  const result = db.select({ count: sql<number>`count(*)` })
    .from(oracleDocuments)
    .get();
  return result?.count || 0;
}

function getCountByType(): Array<{ type: string; count: number }> {
  return db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(*)`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();
}

function getLastIndexedInfo(): { lastIndexedDate: string | null; indexAgeHours: number | null } {
  const result = db.select({ lastIndexed: sql<number | null>`max(${oracleDocuments.indexedAt})` })
    .from(oracleDocuments)
    .get();

  const lastIndexedDate = result?.lastIndexed
    ? new Date(result.lastIndexed).toISOString()
    : null;

  const indexAgeHours = result?.lastIndexed
    ? (Date.now() - result.lastIndexed) / (1000 * 60 * 60)
    : null;

  return { lastIndexedDate, indexAgeHours };
}

function getIndexingStatus() {
  let idxStatus = { is_indexing: false, progress_current: 0, progress_total: 0, completed_at: null as number | null };
  try {
    const status = db.select({
      isIndexing: indexingStatus.isIndexing,
      progressCurrent: indexingStatus.progressCurrent,
      progressTotal: indexingStatus.progressTotal,
      completedAt: indexingStatus.completedAt
    })
      .from(indexingStatus)
      .where(eq(indexingStatus.id, 1))
      .get();

    if (status) {
      idxStatus = {
        is_indexing: status.isIndexing === 1,
        progress_current: status.progressCurrent || 0,
        progress_total: status.progressTotal || 0,
        completed_at: status.completedAt
      };
    }
  } catch (e) {
    // Table doesn't exist yet, use defaults
  }
  return idxStatus;
}

function getUniqueFilesByType(): Array<{ type: string; count: number }> {
  return db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(DISTINCT ${oracleDocuments.sourceFile})`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();
}

/**
 * Get vector DB stats for the stats endpoint
 */
export async function handleVectorStats(): Promise<{
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
}> {
  const timeout = parseInt(process.env.ORACLE_CHROMA_TIMEOUT || '5000', 10);
  const models = getEmbeddingModels();
  const engines: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }> = [];

  await Promise.all(
    Object.entries(models).map(async ([key, preset]) => {
      try {
        const store = await ensureVectorStoreConnected(key);
        const stats = await Promise.race([
          store.getStats(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeout)
          ),
        ]);
        engines.push({ key, model: preset.model, collection: preset.collection, count: stats.count, enabled: true });
      } catch {
        engines.push({ key, model: preset.model, collection: preset.collection, count: 0, enabled: false });
      }
    })
  );

  const primary = engines.find(e => e.key === 'bge-m3') || engines[0];
  return {
    vector: {
      enabled: primary?.enabled ?? false,
      count: primary?.count ?? 0,
      collection: primary?.collection ?? 'oracle_knowledge_bge_m3'
    },
    vectors: engines,
  };
}
