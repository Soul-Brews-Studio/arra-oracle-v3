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
import { REPO_ROOT, VECTOR_URL } from '../config.ts';
import { logSearch, logDocumentAccess, logLearning } from './logging.ts';
import type { SearchResult, SearchResponse } from './types.ts';
import { ensureVectorStoreConnected, EMBEDDING_MODELS } from '../vector/factory.ts';
import { detectProject } from './project-detect.ts';
import { coerceConcepts } from '../tools/learn.ts';
import { createVectorProxy } from './vector-proxy.ts';
import { buildLearningMarkdown, dateSlug } from '../learn/markdown.ts';

// Module-level proxy instance — bound to VECTOR_URL at boot. If VECTOR_URL is
// unset, this is null and the local vector adapter runs in-process (legacy
// behavior). When set, the vector leg of hybrid/vector search proxies to the
// remote service; on remote failure we fall back to FTS5-only.
const vectorProxy = createVectorProxy(VECTOR_URL);

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
): Promise<SearchResponse & { mode?: string; warning?: string; model?: string; vectorAvailable?: boolean }> {
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
  // Tracks whether the vector leg succeeded. Stays `true` when mode === 'fts'
  // (vector wasn't asked for), flips to `false` if the proxy is enabled and
  // the remote call failed — clients use this to render a "vector down" hint
  // while still getting FTS5 results.
  let vectorAvailable = true;

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
    });
    if (remote) {
      vectorResults = remote.results || [];
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

    // Query all models in parallel
    const modelResults = await Promise.allSettled(
      modelsToQuery.map(async (m) => {
        const modelName = m || 'bge-m3';
        console.log(`[Vector] Searching model=${modelName} for: "${query.substring(0, 30)}..."`);
        const client = await ensureVectorStoreConnected(m);
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
      const client = await ensureVectorStoreConnected(model && EMBEDDING_MODELS[model] ? model : undefined);
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
    ...(mode !== 'fts' ? { vectorAvailable } : {}),
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
