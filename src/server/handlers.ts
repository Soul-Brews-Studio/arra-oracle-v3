/**
 * Oracle v2 Core Request Handlers
 *
 * Partially migrated to Drizzle ORM. FTS5 operations remain as raw SQL
 * since Drizzle doesn't support virtual tables.
 */

import fs from 'fs';
import path from 'path';
import { eq, sql, or, inArray } from 'drizzle-orm';
import { db, sqlite, oracleDocuments, indexingStatus, isDbLockError } from '../db/index.ts';
import { REPO_ROOT, resolveVectorUrl } from '../config.ts';
import { logSearch, logDocumentAccess, logLearning } from './logging.ts';
import type { SearchResult, SearchResponse } from './types.ts';
import { ensureBooksVectorStoreConnected, ensureVectorStoreConnected, EMBEDDING_MODELS } from '../vector/factory.ts';
import { detectProject } from './project-detect.ts';
import { coerceConcepts } from '../tools/learn.ts';
import { createVectorProxy } from './vector-proxy.ts';
import { buildLearningMarkdown, dateSlug } from '../learn/markdown.ts';
import { documentTypeMatchesSearchCorpus, normalizeSearchCorpus, sqlCorpusPredicate } from '../search/corpus.ts';
import { RERANK_POOL_SIZE, rerankCandidates } from './reranker.ts';

function getVectorProxy() {
  return createVectorProxy(resolveVectorUrl());
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
  model?: string,    // Embedding model: 'bge-m3' (default, multilingual) or 'nomic' (fast)
  corpus?: string    // Optional spike route: books | memory | both
): Promise<SearchResponse & {
  mode?: string;
  warning?: string;
  model?: string;
  corpus?: string;
  vectorAvailable?: boolean;
  reranked?: boolean;
  rerankFallbackReason?: string;
}> {
  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const startTime = Date.now();
  // A1: allowlist sanitizer — keep ONLY Unicode letters/numbers/whitespace (so Thai and
  // other scripts survive) and strip every punctuation char. The previous blocklist
  // missed `=`, `.`, `,` (and more), which reach FTS5 MATCH as syntax and throw
  // ("Search failed" → HTTP 400). An allowlist can never leak a syntax char.
  const safeQuery = query
    .replace(/<[^>]*>/g, ' ')            // Strip HTML tags
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // Keep letters/numbers/space (Thai-safe); drop punctuation
    .replace(/\s+/g, ' ')
    .trim();
  if (!safeQuery) {
    return { results: [], total: 0, limit, offset, query };
  }
  // A3: build the FTS5 MATCH expression as quoted OR-of-terms. Bareword separation is
  // implicit-AND, so a long natural-language / Thai query needs EVERY term present →
  // 0 hits when one rare word is absent. OR lets BM25 (ORDER BY rank) score by how many
  // and how rare the matched terms are — real BM25 recall, not all-or-nothing. Quoting
  // each term also makes AND/OR/NOT/NEAR appearing IN the query literal tokens, not
  // operators, so the expression can't become malformed.
  const ftsMatch = safeQuery.split(' ').filter(Boolean).map(t => `"${t}"`).join(' OR ');

  let warning: string | undefined;
  const corpusMode = normalizeSearchCorpus(corpus);

  // FTS5 search (skip if vector-only mode)
  let ftsResults: SearchResult[] = [];
  let ftsTotal = 0;

  // Project filter: if project specified, include project + universal (NULL)
  // If no project, return ALL documents (no filter)
  const projectFilter = resolvedProject
    ? '(d.project = ? OR d.project IS NULL)'
    : '1=1';
  const projectParams = resolvedProject ? [resolvedProject] : [];
  const corpusFilter = sqlCorpusPredicate('d', corpusMode);
  const baseFilter = `${projectFilter} AND ${corpusFilter}`;

  // FTS5 search must use raw SQL (Drizzle doesn't support virtual tables)
  if (mode !== 'vector') {
    try {
      if (type === 'all') {
        const countStmt = sqlite.prepare(`
          SELECT COUNT(*) as total
          FROM oracle_fts f
          JOIN oracle_documents d ON f.id = d.id
          WHERE oracle_fts MATCH ? AND ${baseFilter}
        `);
        ftsTotal = (countStmt.get(ftsMatch, ...projectParams) as { total: number }).total;

        const stmt = sqlite.prepare(`
          SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
          FROM oracle_fts f
          JOIN oracle_documents d ON f.id = d.id
          WHERE oracle_fts MATCH ? AND ${baseFilter}
          ORDER BY rank
          LIMIT ?
        `);
        ftsResults = stmt.all(ftsMatch, ...projectParams, limit * 2).map((row: any) => ({
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
          WHERE oracle_fts MATCH ? AND d.type = ? AND ${baseFilter}
        `);
        ftsTotal = (countStmt.get(ftsMatch, type, ...projectParams) as { total: number }).total;

        const stmt = sqlite.prepare(`
          SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
          FROM oracle_fts f
          JOIN oracle_documents d ON f.id = d.id
          WHERE oracle_fts MATCH ? AND d.type = ? AND ${baseFilter}
          ORDER BY rank
          LIMIT ?
        `);
        ftsResults = stmt.all(ftsMatch, type, ...projectParams, limit * 2).map((row: any) => ({
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
    } catch (err) {
      // A2: a failing FTS leg must never 400 the whole request. Degrade to an empty FTS
      // list so the vector leg — and the combiner's single-leg passthrough — still serve.
      console.error('[FTS Search Error]', err instanceof Error ? err.message : String(err));
      ftsResults = [];
      ftsTotal = 0;
      if (!warning) warning = 'FTS search error — vector-only results';
    }
  }

  // Vector search (skip if fts-only mode)
  let vectorResults: SearchResult[] = [];
  let remoteVectorTotal: number | undefined;
  // Tracks whether the vector leg succeeded. Stays `true` when mode === 'fts'
  // (vector wasn't asked for), flips to `false` if the proxy is enabled and
  // the remote call failed — clients use this to render a "vector down" hint
  // while still getting FTS5 results.
  let vectorAvailable = true;
  const vectorProxy = getVectorProxy();

  // VECTOR_URL set → route the vector leg through the remote service.
  // FTS5 always runs locally above. If the proxy fails we return whatever FTS5
  // produced and set vectorAvailable: false (per VECTOR_FALLBACK = 'fts5').
  if (mode !== 'fts' && vectorProxy) {
    const remote = await vectorProxy.search({
      q: query,
      type,
      limit,
      offset,
      mode: 'vector',
      project: resolvedProject ?? undefined,
      cwd,
      model,
      corpus: corpusMode,
    });
    if (remote) {
      vectorResults = remote.results || [];
      if (typeof remote.total === 'number') remoteVectorTotal = remote.total;
    } else {
      vectorAvailable = false;
      warning = 'Vector proxy unavailable — FTS5-only results';
    }
  } else if (mode !== 'fts') {
    // Determine which models to query
    const isMulti = model === 'multi';
    const modelsToQuery = isMulti
      ? ['bge-m3', 'nomic']
      : [model && EMBEDDING_MODELS[model] ? model : undefined];
    const queryScopes: Array<'memory' | 'books'> = corpusMode === 'books'
      ? ['books']
      : corpusMode === 'memory'
        ? ['memory']
        : ['memory', 'books'];

    // Query all models in parallel
    const modelResults = await Promise.allSettled(
      modelsToQuery.flatMap((m) => queryScopes.map(async (scope) => {
        const modelName = m || 'bge-m3';
        console.log(`[Vector] Searching model=${modelName} corpus=${scope} for: "${query.substring(0, 30)}..."`);
        const client = scope === 'books'
          ? await ensureBooksVectorStoreConnected(m)
          : await ensureVectorStoreConnected(m);
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
            const similarity = Math.max(0, 1 - distance / 2);
            const docProject = projectMap.has(id) ? projectMap.get(id) : null;
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
            if (!documentTypeMatchesSearchCorpus(r.type, scope)) return false;
            if (!resolvedProject) return true;
            return r.project === resolvedProject || r.project === null;
          });
      }))
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
  let combined = combineSearchResults(ftsResults, vectorResults);

  // Cross-encoder rerank over hybrid head (parity with MCP tools/search.ts).
  const rerankHead = combined.slice(0, RERANK_POOL_SIZE);
  const rerankTail = combined.slice(RERANK_POOL_SIZE);
  const reranked = await rerankCandidates({
    query,
    candidates: rerankHead,
    getText: (r) => r.content,
  });
  if (reranked.reranked) {
    combined = [...reranked.results, ...rerankTail];
  }

  // For vector-only mode, ftsTotal is 0 and combined.length is just top-N,
  // so use the vector collection count as the total for accurate display
  let total = Math.max(ftsTotal, combined.length);
  if (mode === 'vector' && vectorProxy && remoteVectorTotal !== undefined) {
    total = remoteVectorTotal;
  } else if (mode === 'vector' && vectorResults.length > 0) {
    try {
      const targetModel = model && EMBEDDING_MODELS[model] ? model : undefined;
      const memoryStats = corpusMode !== 'books'
        ? await (await ensureVectorStoreConnected(targetModel)).getStats()
        : { count: 0 };
      const bookStats = corpusMode !== 'memory'
        ? await (await ensureBooksVectorStoreConnected(targetModel)).getStats()
        : { count: 0 };
      const count = memoryStats.count + bookStats.count;
      if (count > 0) total = count;
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
    ...(corpus ? { corpus: corpusMode } : {}),
    ...(model === 'multi' ? { model: 'multi' } : model && EMBEDDING_MODELS[model] ? { model } : {}),
    ...(mode !== 'fts' ? { vectorAvailable } : {}),
    ...(warning && { warning }),
    reranked: reranked.reranked,
    ...(reranked.fallbackReason ? { rerankFallbackReason: reranked.fallbackReason } : {}),
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
  // Single leg → preserve that leg's own scores (lever-fixed cosine similarity for
  // vector-only, FTS rank for fts-only). RRF only makes sense when fusing two lists.
  if (fts.length === 0) return vector;
  if (vector.length === 0) return fts;

  // Hybrid → Reciprocal Rank Fusion (RRF, K=60): fuses two rank-sorted lists across
  // incompatible score scales (FTS5 rank vs cosine similarity) without weight tuning,
  // so a bounded cosine score can't be swamped by (or swamp) the keyword leg.
  // fused(d) = Σ 1 / (K + rank_d). Inputs arrive already rank-sorted (rank = index).
  const K = 60;
  const merged = new Map<string, SearchResult>();
  const rrf = new Map<string, number>();
  const rank = (list: SearchResult[]) => list.forEach((r, i) => {
    rrf.set(r.id, (rrf.get(r.id) || 0) + 1 / (K + i + 1));
    const prev = merged.get(r.id);
    // Keep first-seen content; let the vector leg contribute distance/model.
    merged.set(r.id, prev ? { ...prev, distance: r.distance ?? prev.distance, model: r.model ?? prev.model } : r);
  });
  rank(fts);
  rank(vector);

  const ftsIds = new Set(fts.map(r => r.id));
  const vecIds = new Set(vector.map(r => r.id));
  return Array.from(merged.values())
    .map(r => ({
      ...r,
      score: rrf.get(r.id) || 0,
      source: (ftsIds.has(r.id) && vecIds.has(r.id) ? 'hybrid' : r.source) as SearchResult['source'],
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Get random wisdom
 */
export function handleReflect() {
  try {
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
  } catch (err) {
    if (isDbLockError(err)) {
      return {
        id: null,
        type: 'principle',
        content: 'Oracle is indexing — please wait...',
        source_file: null,
        concepts: [],
        indexing: true,
      };
    }
    throw err;
  }
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
 * Add new pattern/learning to knowledge base
 * @param origin - 'mother' | 'arthur' | 'volt' | 'human' (null = universal)
 * @param project - ghq-style project path (null = universal)
 * @param cwd - Auto-detect project from cwd if project not specified
 */
/**
 * Persist a learning-type document: write .md file, insert row in oracle_documents + FTS.
 * Shared by handleLearn and handleSessionSummary so both take the same path post-#867.
 */
export function persistLearningDoc(opts: {
  pattern: string;
  subdir: string;          // e.g. 'ψ/memory/learnings' or 'ψ/memory/session-summaries'
  filename: string;        // base filename, e.g. '2026-04-19_my-slug.md' or '<session-id>.md'
  id: string;              // document id
  concepts?: string[];
  source?: string;         // display + logging
  origin?: string | null;  // 'mother' | 'arthur' | 'volt' | 'human' | null
  project?: string | null;
  createdBy?: string;      // oracle_documents.created_by
  footer?: string;         // footer line under the content, e.g. '*Added via Oracle Learn*'
}): { file: string; id: string } {
  const { pattern, subdir, filename, id } = opts;
  const now = new Date();

  const dir = path.join(REPO_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);

  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  const title = pattern.split('\n')[0].substring(0, 80);
  const conceptsList = coerceConcepts(opts.concepts);
  const frontmatter = buildLearningMarkdown({
    id,
    pattern,
    title,
    concepts: conceptsList,
    createdAt: now,
    source: opts.source,
    project: opts.project,
    footer: opts.footer,
  });

  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  const sourceFile = `${subdir}/${filename}`;

  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: opts.origin || null,
    project: opts.project || null,
    createdBy: opts.createdBy || 'oracle_learn',
  }).run();

  // FTS5 has no unique constraint on id — delete-then-insert to be idempotent.
  sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`).run(id);
  sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(id, frontmatter, conceptsList.join(' '));

  logLearning(id, pattern, opts.source || 'Oracle Learn', conceptsList);

  return { file: sourceFile, id };
}

export function handleLearn(
  pattern: string,
  source?: string,
  concepts?: string[],
  origin?: string,
  project?: string,
  cwd?: string
) {
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const d = new Date();
  const dateStr = dateSlug(d);

  const slug = pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // On slug collision (same date + same first-50-char prefix), append -2, -3, …
  // until unique. Prevents 500s when two writes share a slug within one day
  // (e.g. repeated hot-write snapshots from the same agent).
  const subdir = 'ψ/memory/learnings';
  const learningsDir = path.join(REPO_ROOT, subdir);
  let uniqueSlug = slug;
  let suffix = 2;
  while (fs.existsSync(path.join(learningsDir, `${dateStr}_${uniqueSlug}.md`))) {
    uniqueSlug = `${slug}-${suffix}`;
    suffix++;
  }

  const { file, id } = persistLearningDoc({
    pattern,
    subdir,
    filename: `${dateStr}_${uniqueSlug}.md`,
    id: `learning_${dateStr}_${uniqueSlug}`,
    concepts,
    source,
    origin,
    project: resolvedProject,
    createdBy: 'oracle_learn',
  });

  return { success: true, file, id };
}

/**
 * Persist a session summary as a learning with concepts
 * ["session-summary", "session-<id>", "oracle-<name>"].
 * Written to ψ/memory/session-summaries/<session-id>.md so `oracle_search` surfaces it.
 */
export function handleSessionSummary(
  sessionId: string,
  summary: string,
  oracle?: string
): { ok: true; source_file: string; learning_id: string } {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  if (!safeSession) throw new Error('Invalid session id');

  const concepts = ['session-summary', `session-${safeSession}`];
  if (oracle) {
    const safeOracle = oracle.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
    if (safeOracle) concepts.push(`oracle-${safeOracle}`);
  }

  const { file, id } = persistLearningDoc({
    pattern: summary,
    subdir: 'ψ/memory/session-summaries',
    filename: `${safeSession}.md`,
    id: `session-summary_${safeSession}`,
    concepts,
    source: oracle ? `session-summary from ${oracle}` : 'session-summary',
    createdBy: 'session_summary',
    footer: '*Added via session auto-summary*',
  });

  return { ok: true, source_file: file, learning_id: id };
}
