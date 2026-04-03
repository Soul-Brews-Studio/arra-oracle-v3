/**
 * Oracle v2 Core Request Handlers
 *
 * Re-exports from extracted modules for backward compatibility.
 * Small handlers (handleList, handleGraph) remain here.
 *
 * Partially migrated to Drizzle ORM. FTS5 operations remain as raw SQL
 * since Drizzle doesn't support virtual tables.
 */

import { eq, sql } from 'drizzle-orm';
import { db, sqlite, oracleDocuments } from '../db/index.ts';
import type { SearchResponse } from './types.ts';

// Re-export all handlers from extracted modules
export { handleSearch, handleReflect, handleSimilar } from './search.ts';
export { handleMap } from './map.ts';
export { handleMap3d } from './map3d.ts';
export { handleStats, handleVectorStats } from './stats.ts';
export { handleLearn } from './learn.ts';

/**
 * List all documents (browse without search)
 * @param groupByFile - if true, dedupe by source_file (show one entry per file)
 *
 * Note: Uses raw SQL for FTS JOIN since Drizzle doesn't support virtual tables.
 */
export function handleList(
  type: string = 'all',
  limit: number = 10,
  offset: number = 0,
  groupByFile: boolean = true
): SearchResponse {
  if (limit < 1 || limit > 100) limit = 10;
  if (offset < 0) offset = 0;

  if (groupByFile) {
    return listGroupedByFile(type, limit, offset);
  }
  return listFlat(type, limit, offset);
}

/** List documents grouped by source_file */
function listGroupedByFile(type: string, limit: number, offset: number): SearchResponse {
  const total = countDistinctFiles(type);
  const typeFilter = type === 'all' ? '' : 'WHERE d.type = ?';
  const typeParams = type === 'all' ? [] : [type];

  const stmt = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.project, MAX(d.indexed_at) as indexed_at, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    ${typeFilter}
    GROUP BY d.source_file
    ORDER BY indexed_at DESC
    LIMIT ? OFFSET ?
  `);
  const results = stmt.all(...typeParams, limit, offset).map(mapListRow);

  return { results, total, offset, limit };
}

/** List documents without grouping */
function listFlat(type: string, limit: number, offset: number): SearchResponse {
  const total = countDocuments(type);
  const typeFilter = type === 'all' ? '' : 'WHERE d.type = ?';
  const typeParams = type === 'all' ? [] : [type];

  const stmt = sqlite.prepare(`
    SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.indexed_at, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON d.id = f.id
    ${typeFilter}
    ORDER BY d.indexed_at DESC
    LIMIT ? OFFSET ?
  `);
  const results = stmt.all(...typeParams, limit, offset).map(mapListRow);

  return { results, total, offset, limit };
}

/** Map a raw list row to result object */
function mapListRow(row: any) {
  return {
    id: row.id,
    type: row.type,
    content: row.content || '',
    source_file: row.source_file,
    concepts: row.concepts ? JSON.parse(row.concepts) : [],
    project: row.project,
    indexed_at: row.indexed_at
  };
}

/** Count distinct source_files, optionally filtered by type */
function countDistinctFiles(type: string): number {
  if (type === 'all') {
    const result = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
      .from(oracleDocuments)
      .get();
    return result?.total || 0;
  }
  const result = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, type))
    .get();
  return result?.total || 0;
}

/** Count all documents, optionally filtered by type */
function countDocuments(type: string): number {
  if (type === 'all') {
    const result = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .get();
    return result?.total || 0;
  }
  const result = db.select({ total: sql<number>`count(*)` })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.type, type))
    .get();
  return result?.total || 0;
}

/**
 * Get knowledge graph data
 * Accepts `limit` per type (default 200, max 500).
 * Links capped at 5000.
 */
export function handleGraph(limitPerType = 310) {
  const perType = Math.min(Math.max(limitPerType, 10), 500);
  const docs = fetchGraphDocuments(perType);
  const nodes = buildGraphNodes(docs);
  const links = buildGraphLinks(nodes);
  return { nodes, links };
}

/** Fetch random samples from each document type for the graph */
function fetchGraphDocuments(perType: number) {
  const selectFields = {
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project
  };

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

  return [...principles, ...learnings, ...retros];
}

/** Build graph node objects from document rows */
function buildGraphNodes(docs: any[]) {
  return docs.map(doc => ({
    id: doc.id,
    type: doc.type,
    source_file: doc.sourceFile,
    project: doc.project,
    concepts: JSON.parse(doc.concepts || '[]')
  }));
}

/** Build graph links based on shared concepts between nodes */
function buildGraphLinks(nodes: any[]) {
  const links: { source: string; target: string; weight: number }[] = [];
  const MAX_LINKS = 5000;
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

  return links;
}
