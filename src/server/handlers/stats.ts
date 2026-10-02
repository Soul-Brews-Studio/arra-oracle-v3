import { eq, sql, or } from 'drizzle-orm';
import { db, sqlite, oracleDocuments, indexingStatus, isDbLockError } from '../../db/index.ts';

export function handleStats(dbPath: string) {
  // Total documents using Drizzle
  const totalDocsResult = db.select({ count: sql<number>`count(*)` })
    .from(oracleDocuments)
    .get();
  const totalDocs = totalDocsResult?.count || 0;

  // Count by type using Drizzle
  const byTypeResults = db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(*)`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();

  // Get last indexed timestamp using Drizzle
  const lastIndexedResult = db.select({ lastIndexed: sql<number | null>`max(${oracleDocuments.indexedAt})` })
    .from(oracleDocuments)
    .get();

  const lastIndexedDate = lastIndexedResult?.lastIndexed
    ? new Date(lastIndexedResult.lastIndexed).toISOString()
    : null;

  // Calculate age in hours
  const indexAgeHours = lastIndexedResult?.lastIndexed
    ? (Date.now() - lastIndexedResult.lastIndexed) / (1000 * 60 * 60)
    : null;

  // Get indexing status using Drizzle
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

  // Unique files by type (deduped by source_file)
  const uniqueByType = db.select({
    type: oracleDocuments.type,
    count: sql<number>`count(DISTINCT ${oracleDocuments.sourceFile})`
  })
    .from(oracleDocuments)
    .groupBy(oracleDocuments.type)
    .all();

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

/**
 * Get knowledge graph data
 * Accepts `limit` per type (default 200, max 500).
 * Links capped at 5000 (frontend caps at 3000 anyway).
 */
export function handleGraph(limitPerType = 310) {
  const perType = Math.min(Math.max(limitPerType, 10), 500);

  const selectFields = {
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project
  };

  // Get random sample from each type
  const principles = db.select(selectFields)
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, 'principle'))
    .orderBy(sql`RANDOM()`)
    .limit(perType)
    .all();

  const learnings = db.select(selectFields)
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, 'learning'))
    .orderBy(sql`RANDOM()`)
    .limit(perType)
    .all();

  const retros = db.select(selectFields)
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, 'retro'))
    .orderBy(sql`RANDOM()`)
    .limit(perType)
    .all();

  const docs = [...principles, ...learnings, ...retros];

  // Build nodes
  const nodes = docs.map(doc => ({
    id: doc.id,
    type: doc.type,
    source_file: doc.sourceFile,
    project: doc.project,
    concepts: JSON.parse(doc.concepts || '[]')
  }));

  // Build links based on shared concepts (require 2+ shared for stronger connections)
  const links: { source: string; target: string; weight: number }[] = [];
  const MAX_LINKS = 5000;

  // Pre-compute concept sets
  const conceptSets = nodes.map(n => new Set(n.concepts));

  for (let i = 0; i < nodes.length && links.length < MAX_LINKS; i++) {
    for (let j = i + 1; j < nodes.length && links.length < MAX_LINKS; j++) {
      const sharedCount = nodes[j].concepts.filter((c: string) => conceptSets[i].has(c)).length;

      if (sharedCount >= 1) {
        links.push({
          source: nodes[i].id,
          target: nodes[j].id,
          weight: sharedCount
        });
      }
    }
  }

  return { nodes, links };
}
