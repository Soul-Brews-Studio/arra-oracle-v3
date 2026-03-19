/**
 * Oracle v2 Core Request Handlers
 *
 * Partially migrated to Drizzle ORM. FTS5 operations remain as raw SQL
 * since Drizzle doesn't support virtual tables.
 */

import fs from 'fs';
import path from 'path';
import { eq, sql, or, inArray } from 'drizzle-orm';
import { db, sqlite, oracleDocuments, indexingStatus } from '../db/index.ts';
import { REPO_ROOT } from '../config.ts';
import { logSearch, logDocumentAccess, logLearning } from './logging.ts';
import type { SearchResult, SearchResponse } from './types.ts';
import { getVectorStoreByModel, ensureVectorStoreConnected, getEmbeddingModels, EMBEDDING_MODELS } from '../vector/factory.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import { detectProject } from './project-detect.ts';
import { coerceConcepts } from '../tools/learn.ts';

// Use shared model-based vector store registry
async function getVectorStore(model?: string): Promise<VectorStoreAdapter> {
  return ensureVectorStoreConnected(model);
}

/**
 * Search Oracle knowledge base with hybrid search (FTS5 + Vector)
 * HTTP server can safely use ChromaMcpClient since it's not an MCP server
 */
export async function handleSearch(
  query: string,
  type: string = 'all',
  limit: number = 10,
  offset: number = 0,
  mode: 'hybrid' | 'fts' | 'vector' = 'hybrid',
  project?: string,  // If set: project + universal. If null/undefined: universal only
  cwd?: string,      // Auto-detect project from cwd if project not specified
  model?: string     // Embedding model: 'bge-m3' (default, multilingual) or 'nomic' (fast)
): Promise<SearchResponse & { mode?: string; warning?: string; model?: string }> {
  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const startTime = Date.now();
  // Remove FTS5 special characters and HTML: ? * + - ( ) ^ ~ " ' : < > { } [ ] ; / \
  const safeQuery = query
    .replace(/<[^>]*>/g, ' ')           // Strip HTML tags
    .replace(/[?*+\-()^~"':;<>{}[\]\\\/]/g, ' ')  // Strip FTS5 + SQL special chars
    .replace(/\s+/g, ' ')
    .trim();
  if (!safeQuery) {
    return { results: [], total: 0, limit, offset, query };
  }

  let warning: string | undefined;

  // FTS5 search (skip if vector-only mode)
  let ftsResults: SearchResult[] = [];
  let ftsTotal = 0;

  // Project filter: if project specified, include project + universal (NULL)
  // If no project, return ALL documents (no filter)
  const projectFilter = resolvedProject
    ? '(d.project = ? OR d.project IS NULL)'
    : '1=1';
  const projectParams = resolvedProject ? [resolvedProject] : [];

  // FTS5 search must use raw SQL (Drizzle doesn't support virtual tables)
  if (mode !== 'vector') {
    if (type === 'all') {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as total
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}
      `);
      ftsTotal = (countStmt.get(safeQuery, ...projectParams) as { total: number }).total;

      const stmt = sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = stmt.all(safeQuery, ...projectParams, limit * 2).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        source: 'fts' as const,
        score: normalizeRank(row.score)
      }));
    } else {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as total
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? AND ${projectFilter}
      `);
      ftsTotal = (countStmt.get(safeQuery, type, ...projectParams) as { total: number }).total;

      const stmt = sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? AND ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = stmt.all(safeQuery, type, ...projectParams, limit * 2).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        source: 'fts' as const,
        score: normalizeRank(row.score)
      }));
    }
  }

  // Vector search (skip if fts-only mode)
  let vectorResults: SearchResult[] = [];

  if (mode !== 'fts') {
    // Determine which models to query
    const isMulti = model === 'multi';
    const modelsToQuery = isMulti
      ? ['bge-m3', 'nomic']
      : [model && EMBEDDING_MODELS[model] ? model : undefined];

    // Query all models in parallel
    const modelResults = await Promise.allSettled(
      modelsToQuery.map(async (m) => {
        const modelName = m || 'bge-m3';
        console.log(`[Vector] Searching model=${modelName} for: "${query.substring(0, 30)}..."`);
        const client = await getVectorStore(m);
        const whereFilter = type !== 'all' ? { type } : undefined;
        const chromaResults = await client.query(query, isMulti ? limit : limit * 2, whereFilter);

        if (!chromaResults.ids || chromaResults.ids.length === 0) return [];

        // Get project metadata
        const rows = db.select({ id: oracleDocuments.id, project: oracleDocuments.project })
          .from(oracleDocuments)
          .where(inArray(oracleDocuments.id, chromaResults.ids))
          .all();
        const projectMap = new Map<string, string | null>();
        rows.forEach(r => projectMap.set(r.id, r.project));

        return chromaResults.ids
          .map((id: string, i: number) => {
            const distance = chromaResults.distances?.[i] || 0;
            const similarity = 1 / (1 + distance / 100);
            const docProject = projectMap.get(id);
            return {
              id,
              type: chromaResults.metadatas?.[i]?.type || 'unknown',
              content: chromaResults.documents?.[i] || '',
              source_file: chromaResults.metadatas?.[i]?.source_file || '',
              concepts: [],
              project: docProject,
              source: 'vector' as const,
              score: similarity,
              distance,
              model: modelName
            };
          })
          .filter(r => {
            if (!resolvedProject) return true;
            return r.project === resolvedProject || r.project === null;
          });
      })
    );

    // Merge results from all models
    for (const result of modelResults) {
      if (result.status === 'fulfilled') {
        vectorResults.push(...result.value);
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error('[Vector Search Error]', msg);
        if (!warning) warning = `Vector search error: ${msg}`;
      }
    }

    // For multi-model: deduplicate by id, keep result with best score
    if (isMulti && vectorResults.length > 0) {
      const bestByDoc = new Map<string, SearchResult>();
      for (const r of vectorResults) {
        const existing = bestByDoc.get(r.id);
        if (!existing || (r.score || 0) > (existing.score || 0)) {
          // If found in multiple models, boost score
          const multiBoost = existing ? 0.05 : 0;
          bestByDoc.set(r.id, {
            ...r,
            score: Math.min(1, (r.score || 0) + multiBoost),
            source: existing ? 'hybrid' as const : r.source,
          });
        }
      }
      vectorResults = Array.from(bestByDoc.values());
      console.log(`[Multi] Merged ${vectorResults.length} unique results from ${modelsToQuery.length} models`);
    }

    if (vectorResults.length > 0) {
      console.log(`[Vector] ${vectorResults.length} results, top scores: ${vectorResults.slice(0, 3).map(r => r.score?.toFixed(3))}`);
    }
  }

  // Combine results using hybrid ranking
  const combined = combineSearchResults(ftsResults, vectorResults);
  // For vector-only mode, ftsTotal is 0 and combined.length is just top-N,
  // so use the vector collection count as the total for accurate display
  let total = Math.max(ftsTotal, combined.length);
  if (mode === 'vector' && vectorResults.length > 0) {
    try {
      const client = await getVectorStore(model && EMBEDDING_MODELS[model] ? model : undefined);
      const stats = await client.getStats();
      if (stats.count > 0) total = stats.count;
    } catch (error) {
      console.warn('[Hybrid] getStats for vector-only total failed:', error instanceof Error ? error.message : String(error));
    }
  }

  // Apply pagination
  const results = combined.slice(offset, offset + limit);

  // Log search
  const searchTime = Date.now() - startTime;
  logSearch(query, type, mode, total, searchTime, results);
  results.forEach(r => logDocumentAccess(r.id, 'search'));

  return {
    results,
    total,
    offset,
    limit,
    mode,
    ...(model === 'multi' ? { model: 'multi' } : model && EMBEDDING_MODELS[model] ? { model } : {}),
    ...(warning && { warning })
  };
}

/**
 * Normalize FTS5 rank score to 0-1 range (higher = better)
 */
function normalizeRank(rank: number): number {
  // FTS5 rank is negative (more negative = better match)
  // Convert to positive 0-1 score
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

/**
 * Combine FTS and vector results with hybrid scoring
 */
function combineSearchResults(fts: SearchResult[], vector: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  // Add FTS results first
  for (const r of fts) {
    seen.set(r.id, r);
  }

  // Merge vector results (boost score if found in both)
  for (const r of vector) {
    if (seen.has(r.id)) {
      const existing = seen.get(r.id)!;
      // Use max score + bonus for appearing in both (hybrid boost)
      const maxScore = Math.max(existing.score || 0, r.score || 0);
      const bonus = 0.1; // Bonus for appearing in both FTS and vector
      seen.set(r.id, {
        ...existing,
        score: Math.min(1, maxScore + bonus), // Cap at 1.0
        source: 'hybrid' as const,
        distance: r.distance,
        model: r.model
      });
    } else {
      seen.set(r.id, r);
    }
  }

  // Sort by score descending
  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Get random wisdom
 */
export function handleReflect() {
  // Get random document using Drizzle
  const randomDoc = db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts
  })
    .from(oracleDocuments)
    .where(or(
      eq(oracleDocuments.type, 'principle'),
      eq(oracleDocuments.type, 'learning')
    ))
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!randomDoc) {
    return { error: 'No documents found' };
  }

  // Get content from FTS (must use raw SQL)
  const content = sqlite.prepare(`
    SELECT content FROM oracle_fts WHERE id = ?
  `).get(randomDoc.id) as { content: string } | undefined;

  if (!content) {
    return { error: 'Document content not found in FTS index' };
  }

  return {
    id: randomDoc.id,
    type: randomDoc.type,
    content: content.content,
    source_file: randomDoc.sourceFile,
    concepts: JSON.parse(randomDoc.concepts || '[]')
  };
}

/**
 * List all documents (browse without search)
 * @param groupByFile - if true, dedupe by source_file (show one entry per file)
 *
 * Note: Uses raw SQL for FTS JOIN since Drizzle doesn't support virtual tables.
 * Count queries use Drizzle where possible.
 */
export function handleList(type: string = 'all', limit: number = 10, offset: number = 0, groupByFile: boolean = true): SearchResponse {
  // Validate
  if (limit < 1 || limit > 100) limit = 10;
  if (offset < 0) offset = 0;

  if (groupByFile) {
    // Group by source_file to avoid duplicate entries from same file
    if (type === 'all') {
      // Count distinct files using Drizzle
      const countResult = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
        .from(oracleDocuments)
        .get();
      const total = countResult?.total || 0;

      // Need raw SQL for FTS JOIN with GROUP BY
      const stmt = sqlite.prepare(`
        SELECT d.id, d.type, d.source_file, d.concepts, d.project, MAX(d.indexed_at) as indexed_at, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        GROUP BY d.source_file
        ORDER BY indexed_at DESC
        LIMIT ? OFFSET ?
      `);
      const results = stmt.all(limit, offset).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content || '',
        source_file: row.source_file,
        concepts: row.concepts ? JSON.parse(row.concepts) : [],
        project: row.project,
        indexed_at: row.indexed_at
      }));

      return { results, total, offset, limit };
    } else {
      // Count distinct files for type using Drizzle
      const countResult = db.select({ total: sql<number>`count(distinct ${oracleDocuments.sourceFile})` })
        .from(oracleDocuments)
        .where(eq(oracleDocuments.type, type))
        .get();
      const total = countResult?.total || 0;

      // Need raw SQL for FTS JOIN with GROUP BY
      const stmt = sqlite.prepare(`
        SELECT d.id, d.type, d.source_file, d.concepts, d.project, MAX(d.indexed_at) as indexed_at, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        WHERE d.type = ?
        GROUP BY d.source_file
        ORDER BY indexed_at DESC
        LIMIT ? OFFSET ?
      `);
      const results = stmt.all(type, limit, offset).map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content || '',
        source_file: row.source_file,
        concepts: JSON.parse(row.concepts || '[]'),
        project: row.project,
        indexed_at: row.indexed_at
      }));

      return { results, total, offset, limit };
    }
  }

  // Original behavior without grouping
  if (type === 'all') {
    // Count using Drizzle
    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .get();
    const total = countResult?.total || 0;

    // Need raw SQL for FTS JOIN
    const stmt = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.indexed_at, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      ORDER BY d.indexed_at DESC
      LIMIT ? OFFSET ?
    `);
    const results = stmt.all(limit, offset).map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content || '',
      source_file: row.source_file,
      concepts: row.concepts ? JSON.parse(row.concepts) : [],
      project: row.project,
      indexed_at: row.indexed_at
    }));

    return { results, total, offset, limit };
  } else {
    // Count using Drizzle
    const countResult = db.select({ total: sql<number>`count(*)` })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.type, type))
      .get();
    const total = countResult?.total || 0;

    // Need raw SQL for FTS JOIN
    const stmt = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, d.indexed_at, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
      WHERE d.type = ?
      ORDER BY d.indexed_at DESC
      LIMIT ? OFFSET ?
    `);
    const results = stmt.all(type, limit, offset).map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      source_file: row.source_file,
      concepts: JSON.parse(row.concepts || '[]'),
      project: row.project,
      indexed_at: row.indexed_at
    }));

    return { results, total, offset, limit };
  }
}

/**
 * Get database statistics
 */
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

/**
 * Find similar documents by document ID (vector nearest neighbors)
 */
export async function handleSimilar(
  docId: string,
  limit: number = 5,
  model?: string
): Promise<{ results: SearchResult[]; docId: string }> {
  try {
    const client = await getVectorStore(model && EMBEDDING_MODELS[model] ? model : undefined);
    const chromaResults = await client.queryById(docId, limit);

    if (!chromaResults.ids || chromaResults.ids.length === 0) {
      return { results: [], docId };
    }

    // Enrich with SQLite data (concepts, project)
    const rows = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project
    })
      .from(oracleDocuments)
      .where(inArray(oracleDocuments.id, chromaResults.ids))
      .all();

    const docMap = new Map(rows.map(r => [r.id, r]));

    const results: SearchResult[] = chromaResults.ids.map((id: string, i: number) => {
      const distance = chromaResults.distances?.[i] || 1;
      const similarity = Math.max(0, 1 - distance / 2);
      const doc = docMap.get(id);

      return {
        id,
        type: doc?.type || chromaResults.metadatas?.[i]?.type || 'unknown',
        content: chromaResults.documents?.[i] || '',
        source_file: doc?.sourceFile || chromaResults.metadatas?.[i]?.source_file || '',
        concepts: doc?.concepts ? JSON.parse(doc.concepts) : [],
        project: doc?.project,
        source: 'vector' as const,
        score: similarity
      };
    });

    return { results, docId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Similar Search Error]', msg);
    throw new Error(`Similar search failed: ${msg}`);
  }
}

/**
 * Compute 2D map coordinates for the knowledge map visualization.
 *
 * NOTE: Despite the function name mentioning PCA, this does NOT use real
 * vector embeddings from ChromaDB. Instead it uses a deterministic hash-based
 * layout: projects are placed via Fibonacci sunflower spiral, then docs are
 * scattered within each project cluster using FNV-1a hash of sourceFile.
 *
 * Why not real embeddings?
 * - getAllEmbeddings() over MCP stdio for 20k+ docs × 384-dim is very slow
 * - numpy array() wrappers in chroma-mcp responses break JSON parsing
 * - PCA projection would need a math library not currently in deps
 *
 * To upgrade: batch-fetch embeddings, run PCA server-side, cache the projection.
 *
 * Caches result in memory to avoid recomputing.
 */
let mapCache: { data: any; timestamp: number } | null = null;
const MAP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function handleMap(): Promise<{
  documents: Array<{
    id: string;
    type: string;
    source_file: string;
    concepts: string[];
    chunk_ids: string[];
    project: string | null;
    x: number;
    y: number;
    created_at: string | null;
  }>;
  total: number;
}> {
  // Return cached result if fresh
  if (mapCache && (Date.now() - mapCache.timestamp) < MAP_CACHE_TTL) {
    return mapCache.data;
  }

  try {
    // Get all docs from SQLite (no ChromaDB dependency)
    const allDocs = db.select({
      id: oracleDocuments.id,
      type: oracleDocuments.type,
      sourceFile: oracleDocuments.sourceFile,
      concepts: oracleDocuments.concepts,
      project: oracleDocuments.project,
      createdAt: oracleDocuments.createdAt
    })
      .from(oracleDocuments)
      .all();

    if (allDocs.length === 0) {
      return { documents: [], total: 0 };
    }

    // Deduplicate by source_file — merge concepts and collect chunk IDs
    const fileMap = new Map<string, {
      id: string;
      type: string;
      sourceFile: string;
      allConcepts: string[];
      chunkIds: string[];
      project: string | null;
      createdAt: number | null;
    }>();
    for (const doc of allDocs) {
      const key = doc.sourceFile;
      const existing = fileMap.get(key);
      if (!existing) {
        const concepts = doc.concepts ? JSON.parse(doc.concepts) : [];
        fileMap.set(key, {
          id: doc.id,
          type: doc.type,
          sourceFile: doc.sourceFile,
          allConcepts: concepts,
          chunkIds: [doc.id],
          project: doc.project || null,
          createdAt: doc.createdAt
        });
      } else {
        existing.chunkIds.push(doc.id);
        const newConcepts: string[] = doc.concepts ? JSON.parse(doc.concepts) : [];
        for (const c of newConcepts) {
          if (!existing.allConcepts.includes(c)) existing.allConcepts.push(c);
        }
      }
    }
    const dedupedDocs = Array.from(fileMap.values());

    // Group by project for spatial clustering
    const projectMap = new Map<string, number>();
    let projectIdx = 0;
    for (const doc of dedupedDocs) {
      const proj = doc.project || '_default';
      if (!projectMap.has(proj)) projectMap.set(proj, projectIdx++);
    }

    // Place cluster centers using Fibonacci sunflower (fills disk, no donut)
    const golden = (1 + Math.sqrt(5)) / 2;
    const totalClusters = projectMap.size;
    const clusterCenters = new Map<number, { cx: number; cy: number }>();
    for (let i = 0; i < totalClusters; i++) {
      const angle = i * golden * Math.PI * 2;
      const r = Math.sqrt((i + 0.5) / totalClusters) * 0.75;
      clusterCenters.set(i, { cx: Math.cos(angle) * r, cy: Math.sin(angle) * r });
    }

    // Apply limit after dedup
    const limitedDocs = dedupedDocs.slice(0, 10000);

    const documents = limitedDocs.map((doc) => {
      const proj = doc.project || '_default';
      const clusterIdx = projectMap.get(proj) || 0;
      const center = clusterCenters.get(clusterIdx) || { cx: 0, cy: 0 };

      // Hash-based scatter within cluster — use sourceFile for stable position per file
      const h1 = simpleHash(doc.sourceFile);
      const h2 = simpleHash(doc.sourceFile + '_y');
      // Map uniform [0,1) to roughly gaussian spread
      const localX = (h1 - 0.5) * 0.2;
      const localY = (h2 - 0.5) * 0.2;

      const x = center.cx + localX;
      const y = center.cy + localY;

      return {
        id: doc.id,
        type: doc.type,
        source_file: doc.sourceFile,
        concepts: doc.allConcepts,
        chunk_ids: doc.chunkIds,
        project: doc.project,
        x,
        y,
        created_at: doc.createdAt ? new Date(doc.createdAt).toISOString() : null
      };
    });

    const result = { documents, total: documents.length };
    mapCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map Error]', msg);
    throw new Error(`Map generation failed: ${msg}`);
  }
}

/** Simple deterministic hash → [0,1) float */
function simpleHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10000) / 10000;
}


// ============================================================================
// 3D Knowledge Map — Real PCA from LanceDB embeddings
// ============================================================================

const map3dCaches = new Map<string, { data: any; timestamp: number }>();
const MAP3D_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (PCA is expensive)

/**
 * PCA projection of real embeddings from LanceDB (bge-m3, 1024d → 3d).
 *
 * Algorithm:
 *   1. Load all vectors from LanceDB bge-m3 table
 *   2. Center the data (subtract mean)
 *   3. Compute top 3 principal components via power iteration on covariance matrix
 *   4. Project all vectors onto 3 PCs
 *   5. Merge with SQLite metadata (type, concepts, project)
 *   6. Cache result (recompute on cache expiry)
 */
export async function handleMap3d(model?: string): Promise<{
  documents: Array<{
    id: string;
    type: string;
    title: string;
    source_file: string;
    concepts: string[];
    project: string | null;
    x: number;
    y: number;
    z: number;
    created_at: string | null;
  }>;
  total: number;
  pca_info: {
    variance_explained: number[];
    n_vectors: number;
    n_dimensions: number;
    computed_at: string;
  };
}> {
  const modelKey = model || 'bge-m3';
  const cached = map3dCaches.get(modelKey);
  if (cached && (Date.now() - cached.timestamp) < MAP3D_CACHE_TTL) {
    return cached.data;
  }

  try {
    console.time(`[Map3D:${modelKey}] Total`);

    // Step 1: Get vector store for requested model
    console.time(`[Map3D:${modelKey}] Load embeddings`);
    const store = getVectorStoreByModel(modelKey);
    await ensureVectorStoreConnected(modelKey);

    if (!store.getAllEmbeddings) {
      throw new Error('LanceDB adapter does not support getAllEmbeddings');
    }

    const allData = await store.getAllEmbeddings(25000);
    const { ids, embeddings, metadatas } = allData;
    console.timeEnd('[Map3D] Load embeddings');

    if (embeddings.length === 0) {
      return { documents: [], total: 0, pca_info: { variance_explained: [], n_vectors: 0, n_dimensions: 0, computed_at: new Date().toISOString() } };
    }

    const n = embeddings.length;
    const d = embeddings[0].length;
    console.error(`[Map3D] Loaded ${n} vectors × ${d} dimensions`);

    // Step 2: Build metadata lookup from SQLite
    console.time('[Map3D] Metadata lookup');
    const docLookup = new Map<string, {
      type: string;
      sourceFile: string;
      concepts: string[];
      project: string | null;
      createdAt: number | null;
    }>();

    // Batch query SQLite for all doc IDs
    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const rows = db.select({
        id: oracleDocuments.id,
        type: oracleDocuments.type,
        sourceFile: oracleDocuments.sourceFile,
        concepts: oracleDocuments.concepts,
        project: oracleDocuments.project,
        createdAt: oracleDocuments.createdAt,
      })
        .from(oracleDocuments)
        .where(inArray(oracleDocuments.id, batch))
        .all();

      for (const row of rows) {
        docLookup.set(row.id, {
          type: row.type,
          sourceFile: row.sourceFile,
          concepts: row.concepts ? JSON.parse(row.concepts) : [],
          project: row.project || null,
          createdAt: row.createdAt,
        });
      }
    }
    console.timeEnd('[Map3D] Metadata lookup');

    // Step 3: Deduplicate by source_file (average embeddings for multi-chunk files)
    console.time('[Map3D] Dedup by file');
    const fileGroups = new Map<string, {
      ids: string[];
      vectors: number[][];
      type: string;
      sourceFile: string;
      concepts: string[];
      project: string | null;
      createdAt: number | null;
    }>();

    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const meta = docLookup.get(id);
      const vecMeta = metadatas[i];
      const sourceFile = meta?.sourceFile || vecMeta?.source_file || id;
      const existing = fileGroups.get(sourceFile);

      if (!existing) {
        fileGroups.set(sourceFile, {
          ids: [id],
          vectors: [embeddings[i]],
          type: meta?.type || vecMeta?.type || 'unknown',
          sourceFile,
          concepts: meta?.concepts || [],
          project: meta?.project || null,
          createdAt: meta?.createdAt || null,
        });
      } else {
        existing.ids.push(id);
        existing.vectors.push(embeddings[i]);
        // Merge concepts
        if (meta?.concepts) {
          for (const c of meta.concepts) {
            if (!existing.concepts.includes(c)) existing.concepts.push(c);
          }
        }
      }
    }

    // Average the vectors for each file
    const files = Array.from(fileGroups.values());
    const avgVectors: number[][] = files.map(f => {
      if (f.vectors.length === 1) return f.vectors[0];
      const avg = new Array(d).fill(0);
      for (const v of f.vectors) {
        for (let j = 0; j < d; j++) avg[j] += v[j];
      }
      const count = f.vectors.length;
      for (let j = 0; j < d; j++) avg[j] /= count;
      return avg;
    });
    console.timeEnd('[Map3D] Dedup by file');

    const nFiles = avgVectors.length;
    console.error(`[Map3D] ${nFiles} unique files after dedup`);

    // Step 4: PCA via power iteration
    console.time('[Map3D] PCA');

    // 4a. Compute mean
    const mean = new Float64Array(d);
    for (let i = 0; i < nFiles; i++) {
      const v = avgVectors[i];
      for (let j = 0; j < d; j++) mean[j] += v[j];
    }
    for (let j = 0; j < d; j++) mean[j] /= nFiles;

    // 4b. Center the data (in-place for memory efficiency)
    const centered = avgVectors.map(v => {
      const c = new Float64Array(d);
      for (let j = 0; j < d; j++) c[j] = v[j] - mean[j];
      return c;
    });

    // 4c. Sample for covariance estimation if too many vectors
    const pcaSampleSize = Math.min(nFiles, 5000);
    let pcaSample: Float64Array[];
    if (nFiles <= pcaSampleSize) {
      pcaSample = centered;
    } else {
      // Deterministic sampling: every k-th element
      const step = nFiles / pcaSampleSize;
      pcaSample = [];
      for (let i = 0; i < pcaSampleSize; i++) {
        pcaSample.push(centered[Math.floor(i * step)]);
      }
    }

    // 4d. Power iteration for top 3 eigenvectors
    const numComponents = 3;
    const components: Float64Array[] = [];
    const eigenvalues: number[] = [];

    // Helper: matrix-vector product C*v where C = X^T X / n (covariance)
    // Instead of forming the d×d covariance matrix, compute via X * (X^T * v)
    function covTimesVec(vec: Float64Array): Float64Array {
      const ns = pcaSample.length;
      // First: X^T * v → scalar per sample
      const projections = new Float64Array(ns);
      for (let i = 0; i < ns; i++) {
        let dot = 0;
        const row = pcaSample[i];
        for (let j = 0; j < d; j++) dot += row[j] * vec[j];
        projections[i] = dot;
      }
      // Then: X * projections → d-dimensional result
      const result = new Float64Array(d);
      for (let i = 0; i < ns; i++) {
        const p = projections[i];
        const row = pcaSample[i];
        for (let j = 0; j < d; j++) result[j] += row[j] * p;
      }
      // Divide by n
      for (let j = 0; j < d; j++) result[j] /= ns;
      return result;
    }

    for (let comp = 0; comp < numComponents; comp++) {
      // Random-ish initial vector (deterministic seed)
      let v = new Float64Array(d);
      for (let j = 0; j < d; j++) v[j] = Math.sin((comp + 1) * (j + 1) * 0.1);

      // Deflate: remove projection onto already-found components
      function deflate(vec: Float64Array): Float64Array {
        const result = covTimesVec(vec);
        for (let prev = 0; prev < comp; prev++) {
          const pc = components[prev];
          let dot = 0;
          for (let j = 0; j < d; j++) dot += result[j] * pc[j];
          for (let j = 0; j < d; j++) result[j] -= dot * pc[j];
        }
        return result;
      }

      // Power iteration (50 iterations is plenty for convergence)
      for (let iter = 0; iter < 50; iter++) {
        const Cv = deflate(v);
        // Normalize
        let norm = 0;
        for (let j = 0; j < d; j++) norm += Cv[j] * Cv[j];
        norm = Math.sqrt(norm);
        if (norm < 1e-12) break;
        for (let j = 0; j < d; j++) v[j] = Cv[j] / norm;
      }

      // Compute eigenvalue (Rayleigh quotient)
      const Cv = covTimesVec(v);
      let eigenvalue = 0;
      for (let j = 0; j < d; j++) eigenvalue += v[j] * Cv[j];
      eigenvalues.push(eigenvalue);

      components.push(v);
    }

    // Compute variance explained
    const totalVariance = eigenvalues.reduce((a, b) => a + b, 0);
    const varianceExplained = eigenvalues.map(e => +(e / (totalVariance || 1)).toFixed(4));

    console.timeEnd('[Map3D] PCA');
    console.error(`[Map3D] Variance explained: ${varianceExplained.map(v => (v * 100).toFixed(1) + '%').join(', ')}`);

    // Step 5: Project all vectors onto 3 PCs
    console.time('[Map3D] Project');
    const projected: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < nFiles; i++) {
      const v = centered[i];
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < d; j++) {
        x += v[j] * components[0][j];
        y += v[j] * components[1][j];
        z += v[j] * components[2][j];
      }
      projected.push({ x, y, z });
    }

    // Normalize to [-1, 1] range for the frontend
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of projected) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = maxZ - minZ || 1;

    for (const p of projected) {
      p.x = ((p.x - minX) / rangeX) * 2 - 1;
      p.y = ((p.y - minY) / rangeY) * 2 - 1;
      p.z = ((p.z - minZ) / rangeZ) * 2 - 1;
    }
    console.timeEnd('[Map3D] Project');

    // Step 6: Build response
    const documents = files.map((f, i) => {
      // Title: last part of source_file path, without extension
      const basename = f.sourceFile.split('/').pop() || f.sourceFile;
      const title = basename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

      return {
        id: f.ids[0],
        type: f.type,
        title,
        source_file: f.sourceFile,
        concepts: f.concepts.slice(0, 10), // cap concepts per doc
        project: f.project,
        x: +projected[i].x.toFixed(6),
        y: +projected[i].y.toFixed(6),
        z: +projected[i].z.toFixed(6),
        created_at: f.createdAt ? new Date(f.createdAt).toISOString() : null,
      };
    });

    const result = {
      documents,
      total: documents.length,
      pca_info: {
        variance_explained: varianceExplained,
        n_vectors: n,
        n_dimensions: d,
        computed_at: new Date().toISOString(),
      },
    };

    map3dCaches.set(modelKey, { data: result, timestamp: Date.now() });
    console.timeEnd('[Map3D] Total');
    console.error(`[Map3D] Result: ${documents.length} documents, ${n} raw vectors`);

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Map3D Error]', msg);
    throw new Error(`Map3D generation failed: ${msg}`);
  }
}

/**
 * Get vector DB stats for the stats endpoint
 * Uses getStats() which returns the count from the collection
 */
export async function handleVectorStats(): Promise<{
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
}> {
  const timeout = parseInt(process.env.ORACLE_CHROMA_TIMEOUT || '5000', 10);
  const models = getEmbeddingModels();
  const engines: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }> = [];

  // Query all registered engines in parallel
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

  // Primary = bge-m3 (backward compat)
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

/**
 * Add new pattern/learning to knowledge base
 * @param origin - 'mother' | 'arthur' | 'volt' | 'human' (null = universal)
 * @param project - ghq-style project path (null = universal)
 * @param cwd - Auto-detect project from cwd if project not specified
 */
export function handleLearn(
  pattern: string,
  source?: string,
  concepts?: string[],
  origin?: string,
  project?: string,
  cwd?: string
) {
  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Generate slug from pattern (first 50 chars, alphanumeric + dash)
  const slug = pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `${dateStr}_${slug}.md`;
  const learningsDir = path.join(REPO_ROOT, 'ψ/memory/learnings');
  fs.mkdirSync(learningsDir, { recursive: true });
  const filePath = path.join(learningsDir, filename);

  // Check if file already exists
  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  // Generate title from pattern
  const title = pattern.split('\n')[0].substring(0, 80);

  // Create frontmatter
  const frontmatter = [
    '---',
    `title: ${title}`,
    concepts && concepts.length > 0 ? `tags: [${concepts.join(', ')}]` : 'tags: []',
    `created: ${dateStr}`,
    `source: ${source || 'Oracle Learn'}`,
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    ''
  ].join('\n');

  // Write file
  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  // Re-index the new file
  const content = frontmatter;
  const id = `learning_${dateStr}_${slug}`;
  const conceptsList = coerceConcepts(concepts);

  // Insert into database with provenance using Drizzle
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${filename}`,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: origin || null,          // origin: null = universal/mother
    project: resolvedProject || null, // project: null = universal (auto-detected from cwd)
    createdBy: 'oracle_learn'
  }).run();

  // Insert into FTS (must use raw SQL - Drizzle doesn't support virtual tables)
  sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(
    id,
    content,
    conceptsList.join(' ')
  );

  // Log the learning
  logLearning(id, pattern, source || 'Oracle Learn', conceptsList);

  return {
    success: true,
    file: `ψ/memory/learnings/${filename}`,
    id
  };
}
