/**
 * Search handlers — FTS5 + Vector hybrid search
 *
 * Extracted from handlers.ts for maintainability.
 */

import { inArray } from 'drizzle-orm';
import { db, sqlite, oracleDocuments } from '../db/index.ts';
import { eq, sql, or } from 'drizzle-orm';
import { logSearch, logDocumentAccess } from './logging.ts';
import type { SearchResult, SearchResponse } from './types.ts';
import { ensureVectorStoreConnected, EMBEDDING_MODELS } from '../vector/factory.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import { detectProject } from './project-detect.ts';

async function getVectorStore(model?: string): Promise<VectorStoreAdapter> {
  return ensureVectorStoreConnected(model);
}

/**
 * Search Oracle knowledge base with hybrid search (FTS5 + Vector)
 */
export async function handleSearch(
  query: string,
  type: string = 'all',
  limit: number = 10,
  offset: number = 0,
  mode: 'hybrid' | 'fts' | 'vector' = 'hybrid',
  project?: string,
  cwd?: string,
  model?: string
): Promise<SearchResponse & { mode?: string; warning?: string; model?: string }> {
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const startTime = Date.now();
  const safeQuery = sanitizeQuery(query);
  if (!safeQuery) {
    return { results: [], total: 0, limit, offset, query };
  }

  const { projectFilter, projectParams } = buildProjectFilter(resolvedProject);

  const ftsData = mode !== 'vector'
    ? runFtsSearch(safeQuery, type, limit, projectFilter, projectParams)
    : { results: [], total: 0 };

  const vectorData = mode !== 'fts'
    ? await runVectorSearch(query, type, limit, model, resolvedProject)
    : { results: [] as SearchResult[], warning: undefined };

  const combined = combineSearchResults(ftsData.results, vectorData.results);
  let total = Math.max(ftsData.total, combined.length);
  if (mode === 'vector' && vectorData.results.length > 0) {
    total = await getVectorTotal(model, total);
  }

  const results = combined.slice(offset, offset + limit);
  logSearch(query, type, mode, total, Date.now() - startTime, results);
  results.forEach(r => logDocumentAccess(r.id, 'search'));

  return buildSearchResponse(results, total, offset, limit, mode, model, vectorData.warning);
}

/** Build SQL project filter clause and params */
function buildProjectFilter(resolvedProject: string | null) {
  const projectFilter = resolvedProject
    ? '(d.project = ? OR d.project IS NULL)'
    : '1=1';
  const projectParams = resolvedProject ? [resolvedProject] : [];
  return { projectFilter, projectParams };
}

/** Build the final search response object */
function buildSearchResponse(
  results: SearchResult[], total: number, offset: number, limit: number,
  mode: string, model: string | undefined, warning: string | undefined
): SearchResponse & { mode?: string; warning?: string; model?: string } {
  return {
    results, total, offset, limit, mode,
    ...(model === 'multi' ? { model: 'multi' } : model && EMBEDDING_MODELS[model] ? { model } : {}),
    ...(warning && { warning })
  };
}

/** Strip FTS5 special characters and HTML from query */
function sanitizeQuery(query: string): string {
  return query
    .replace(/<[^>]*>/g, ' ')
    .replace(/[?*+\-()^~"':;<>{}[\]\\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run FTS5 full-text search and return results + total count */
function runFtsSearch(
  safeQuery: string,
  type: string,
  limit: number,
  projectFilter: string,
  projectParams: string[]
): { results: SearchResult[]; total: number } {
  const typeFilter = type === 'all' ? '' : 'AND d.type = ?';
  const typeParams = type === 'all' ? [] : [type];

  const countStmt = sqlite.prepare(`
    SELECT COUNT(*) as total
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeFilter} AND ${projectFilter}
  `);
  const total = (countStmt.get(safeQuery, ...typeParams, ...projectParams) as { total: number }).total;

  const stmt = sqlite.prepare(`
    SELECT f.id, f.content, d.type, d.source_file, d.concepts, d.project, rank as score
    FROM oracle_fts f
    JOIN oracle_documents d ON f.id = d.id
    WHERE oracle_fts MATCH ? ${typeFilter} AND ${projectFilter}
    ORDER BY rank
    LIMIT ?
  `);
  const results = stmt.all(safeQuery, ...typeParams, ...projectParams, limit * 2).map(mapFtsRow);

  return { results, total };
}

/** Map a raw FTS row to a SearchResult */
function mapFtsRow(row: any): SearchResult {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    source_file: row.source_file,
    concepts: JSON.parse(row.concepts || '[]'),
    project: row.project,
    source: 'fts' as const,
    score: normalizeRank(row.score)
  };
}

/** Normalize FTS5 rank score to 0-1 range (higher = better) */
function normalizeRank(rank: number): number {
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

/** Run vector search across one or multiple embedding models */
async function runVectorSearch(
  query: string,
  type: string,
  limit: number,
  model: string | undefined,
  resolvedProject: string | null
): Promise<{ results: SearchResult[]; warning?: string }> {
  const isMulti = model === 'multi';
  const modelsToQuery = isMulti
    ? ['bge-m3', 'nomic']
    : [model && EMBEDDING_MODELS[model] ? model : undefined];

  let warning: string | undefined;

  const modelResults = await Promise.allSettled(
    modelsToQuery.map(m => querySingleModel(m, query, type, limit, isMulti, resolvedProject))
  );

  let vectorResults: SearchResult[] = [];
  for (const result of modelResults) {
    if (result.status === 'fulfilled') {
      vectorResults.push(...result.value);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error('[Vector Search Error]', msg);
      if (!warning) warning = `Vector search error: ${msg}`;
    }
  }

  if (isMulti && vectorResults.length > 0) {
    vectorResults = deduplicateMultiModel(vectorResults);
  }

  if (vectorResults.length > 0) {
    console.log(`[Vector] ${vectorResults.length} results, top scores: ${vectorResults.slice(0, 3).map(r => r.score?.toFixed(3))}`);
  }

  return { results: vectorResults, warning };
}

/** Query a single vector model for results */
async function querySingleModel(
  m: string | undefined,
  query: string,
  type: string,
  limit: number,
  isMulti: boolean,
  resolvedProject: string | null
): Promise<SearchResult[]> {
  const modelName = m || 'bge-m3';
  console.log(`[Vector] Searching model=${modelName} for: "${query.substring(0, 30)}..."`);
  const client = await getVectorStore(m);
  const whereFilter = type !== 'all' ? { type } : undefined;
  const chromaResults = await client.query(query, isMulti ? limit : limit * 2, whereFilter);

  if (!chromaResults.ids || chromaResults.ids.length === 0) return [];

  const rows = db.select({ id: oracleDocuments.id, project: oracleDocuments.project })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.id, chromaResults.ids))
    .all();
  const projectMap = new Map<string, string | null>();
  rows.forEach(r => projectMap.set(r.id, r.project));

  return chromaResults.ids
    .map((id: string, i: number) => mapVectorRow(id, i, chromaResults, projectMap, modelName))
    .filter((r: SearchResult) => {
      if (!resolvedProject) return true;
      return r.project === resolvedProject || r.project === null;
    });
}

/** Map a single vector result row to SearchResult */
function mapVectorRow(
  id: string,
  i: number,
  chromaResults: any,
  projectMap: Map<string, string | null>,
  modelName: string
): SearchResult {
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
}

/** Deduplicate multi-model vector results, keeping best score per doc */
function deduplicateMultiModel(vectorResults: SearchResult[]): SearchResult[] {
  const bestByDoc = new Map<string, SearchResult>();
  for (const r of vectorResults) {
    const existing = bestByDoc.get(r.id);
    if (!existing || (r.score || 0) > (existing.score || 0)) {
      const multiBoost = existing ? 0.05 : 0;
      bestByDoc.set(r.id, {
        ...r,
        score: Math.min(1, (r.score || 0) + multiBoost),
        source: existing ? 'hybrid' as const : r.source,
      });
    }
  }
  const merged = Array.from(bestByDoc.values());
  console.log(`[Multi] Merged ${merged.length} unique results from multiple models`);
  return merged;
}

/** Get total vector count for vector-only mode */
async function getVectorTotal(model: string | undefined, fallback: number): Promise<number> {
  try {
    const client = await getVectorStore(model && EMBEDDING_MODELS[model] ? model : undefined);
    const stats = await client.getStats();
    if (stats.count > 0) return stats.count;
  } catch (error) {
    console.warn('[Hybrid] getStats for vector-only total failed:', error instanceof Error ? error.message : String(error));
  }
  return fallback;
}

/** Combine FTS and vector results with hybrid scoring */
function combineSearchResults(fts: SearchResult[], vector: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  for (const r of fts) {
    seen.set(r.id, r);
  }

  for (const r of vector) {
    if (seen.has(r.id)) {
      const existing = seen.get(r.id)!;
      const maxScore = Math.max(existing.score || 0, r.score || 0);
      const bonus = 0.1;
      seen.set(r.id, {
        ...existing,
        score: Math.min(1, maxScore + bonus),
        source: 'hybrid' as const,
        distance: r.distance,
        model: r.model
      });
    } else {
      seen.set(r.id, r);
    }
  }

  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Get random wisdom
 */
export function handleReflect() {
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
