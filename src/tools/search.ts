/**
 * Oracle Search Handler
 *
 * Hybrid search combining FTS5 keyword search and ChromaDB vector search.
 * Exports pure helper functions (sanitizeFtsQuery, normalizeFtsScore,
 * combineResults, vectorSearch) for testability.
 */

import { logSearch } from '../server/logging.ts';
import { detectProject } from '../server/project-detect.ts';
import { getVectorStoreByModel } from '../vector/factory.ts';
import type { ToolContext, ToolResponse, OracleSearchInput } from './types.ts';

export const searchToolDef = {
  name: 'oracle_search',
  description: 'Search Oracle knowledge base using hybrid search (FTS5 keywords + ChromaDB vectors). Finds relevant principles, patterns, learnings, or retrospectives. Falls back to FTS5-only if ChromaDB unavailable.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "nothing deleted", "force push safety")'
      },
      type: {
        type: 'string',
        enum: ['principle', 'pattern', 'learning', 'retro', 'all'],
        description: 'Filter by document type',
        default: 'all'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
        default: 5
      },
      offset: {
        type: 'number',
        description: 'Number of results to skip (for pagination)',
        default: 0
      },
      mode: {
        type: 'string',
        enum: ['hybrid', 'fts', 'vector'],
        description: 'Search mode: hybrid (default), fts (keywords only), vector (semantic only)',
        default: 'hybrid'
      },
      project: {
        type: 'string',
        description: 'Filter by project (e.g., "github.com/owner/repo"). Returns project + universal results.'
      },
      cwd: {
        type: 'string',
        description: 'Auto-detect project from working directory path (follows symlinks to ghq paths)'
      },
      model: {
        type: 'string',
        enum: ['nomic', 'qwen3', 'bge-m3'],
        description: 'Embedding model: nomic (default, fast 768-dim), qwen3 (cross-language Thai↔English, 4096-dim), or bge-m3 (multilingual, 1024-dim)',
      }
    },
    required: ['query']
  }
};

// ============================================================================
// Pure helper functions (exported for testing)
// ============================================================================

/**
 * Sanitize FTS5 query to prevent parse errors.
 * Removes FTS5 special characters that cause syntax errors.
 */
export function sanitizeFtsQuery(query: string): string {
  let sanitized = query
    .replace(/[?*+\-()^~"':.\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    console.error('[FTS5] Query became empty after sanitization:', query);
    return query;
  }

  return sanitized;
}

/**
 * Normalize FTS5 rank score using exponential decay.
 * FTS5 rank is negative, lower = better match.
 * Converts to 0-1 scale where higher = better.
 */
export function normalizeFtsScore(rank: number): number {
  const absRank = Math.abs(rank);
  return Math.exp(-0.3 * absRank);
}

/**
 * Parse concepts from metadata (JSON string or array).
 */
export function parseConceptsFromMetadata(concepts: unknown): string[] {
  if (!concepts) return [];
  if (Array.isArray(concepts)) return concepts;
  if (typeof concepts === 'string') {
    try {
      const parsed = JSON.parse(concepts);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Vector search using ChromaMcpClient.
 * Performs semantic similarity search on the oracle_knowledge collection.
 */
export async function vectorSearch(
  ctx: ToolContext,
  query: string,
  type: string,
  limit: number,
  model?: string
): Promise<Array<{
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  source: 'vector';
}>> {
  try {
    const whereFilter = type !== 'all' ? { type } : undefined;
    const store = model ? getVectorStoreByModel(model) : ctx.vectorStore;
    console.error(`[VectorSearch] Query: "${query.substring(0, 50)}..." limit=${limit} model=${model || 'default'}`);

    const results = await store.query(query, limit, whereFilter);
    console.error(`[VectorSearch] Results: ${results.ids?.length || 0} documents`);

    if (!results.ids || results.ids.length === 0) {
      return [];
    }

    const mappedResults: Array<{
      id: string;
      type: string;
      content: string;
      source_file: string;
      concepts: string[];
      score: number;
      source: 'vector';
    }> = [];

    for (let i = 0; i < results.ids.length; i++) {
      const metadata = results.metadatas[i] as Record<string, unknown> | null;

      mappedResults.push({
        id: results.ids[i],
        type: (metadata?.type as string) || 'unknown',
        content: (results.documents[i] || '').substring(0, 500),
        source_file: (metadata?.source_file as string) || '',
        concepts: parseConceptsFromMetadata(metadata?.concepts),
        score: results.distances[i] || 0,
        source: 'vector',
      });
    }

    return mappedResults;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[ChromaDB ERROR]', errorMsg);
    return [];
  }
}

/**
 * Combine FTS and vector search results.
 * Deduplicates by document id, calculates hybrid score with 10% boost.
 */
export function combineResults(
  ftsResults: Array<{
    id: string;
    type: string;
    content: string;
    source_file: string;
    concepts: string[];
    score: number;
    source: 'fts';
  }>,
  vectorResults: Array<{
    id: string;
    type: string;
    content: string;
    source_file: string;
    concepts: string[];
    score: number;
    source: 'vector';
  }>,
  ftsWeight: number = 0.5,
  vectorWeight: number = 0.5
): Array<{
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  source: 'fts' | 'vector' | 'hybrid';
  ftsScore?: number;
  vectorScore?: number;
}> {
  const resultMap = new Map<string, {
    id: string;
    type: string;
    content: string;
    source_file: string;
    concepts: string[];
    ftsScore?: number;
    vectorScore?: number;
    source: 'fts' | 'vector' | 'hybrid';
  }>();

  // Add FTS results
  for (const result of ftsResults) {
    resultMap.set(result.id, {
      id: result.id,
      type: result.type,
      content: result.content,
      source_file: result.source_file,
      concepts: result.concepts,
      ftsScore: result.score,
      source: 'fts',
    });
  }

  // Add/merge vector results
  for (const result of vectorResults) {
    const existing = resultMap.get(result.id);
    if (existing) {
      existing.vectorScore = result.score;
      existing.source = 'hybrid';
    } else {
      resultMap.set(result.id, {
        id: result.id,
        type: result.type,
        content: result.content,
        source_file: result.source_file,
        concepts: result.concepts,
        vectorScore: result.score,
        source: 'vector',
      });
    }
  }

  // Calculate hybrid scores
  const combined = Array.from(resultMap.values()).map((result) => {
    let score: number;

    if (result.source === 'hybrid') {
      const fts = result.ftsScore ?? 0;
      const vec = result.vectorScore ?? 0;
      score = ((ftsWeight * fts) + (vectorWeight * vec)) * 1.1;
    } else if (result.source === 'fts') {
      score = (result.ftsScore ?? 0) * ftsWeight;
    } else {
      score = (result.vectorScore ?? 0) * vectorWeight;
    }

    return {
      id: result.id,
      type: result.type,
      content: result.content,
      source_file: result.source_file,
      concepts: result.concepts,
      score,
      source: result.source,
      ftsScore: result.ftsScore,
      vectorScore: result.vectorScore,
    };
  });

  combined.sort((a, b) => b.score - a.score);
  return combined;
}

// ============================================================================
// Handler
// ============================================================================

export async function handleSearch(ctx: ToolContext, input: OracleSearchInput): Promise<ToolResponse> {
  const startTime = Date.now();
  const { query, type = 'all', limit = 5, offset = 0, mode = 'hybrid', project, cwd, model } = input;

  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  const safeQuery = sanitizeFtsQuery(query);

  // Auto-detect project from cwd if not explicitly specified
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;

  // Project filter: if project specified, include project + universal (NULL)
  // If no project, return ALL documents (no filter)
  const projectFilter = resolvedProject
    ? 'AND (d.project = ? OR d.project IS NULL)'
    : '';
  const projectParams = resolvedProject ? [resolvedProject] : [];

  let warning: string | undefined;
  let vectorSearchError = false;

  // Run FTS5 search (skip if vector-only mode)
  let ftsRawResults: any[] = [];
  if (mode !== 'vector') {
    if (type === 'all') {
      const stmt = ctx.sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, rank
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsRawResults = stmt.all(safeQuery, ...projectParams, limit * 2);
    } else {
      const stmt = ctx.sqlite.prepare(`
        SELECT f.id, f.content, d.type, d.source_file, d.concepts, rank
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsRawResults = stmt.all(safeQuery, type, ...projectParams, limit * 2);
    }
  }

  // Run vector search (skip if fts-only mode)
  let vecResults: Awaited<ReturnType<typeof vectorSearch>> = [];
  if (mode !== 'fts') {
    try {
      vecResults = await vectorSearch(ctx, query, type, limit * 2, model);
    } catch (error) {
      vectorSearchError = true;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ChromaDB]', errorMessage);
      warning = `Vector search unavailable: ${errorMessage}. Using FTS5 only.`;
    }

    if (vecResults.length === 0 && !vectorSearchError) {
      warning = warning || 'Vector search returned no results. Using FTS5 results.';
    }
  }

  // Transform FTS results to normalized format
  const ftsResults = ftsRawResults.map((row: any) => ({
    id: row.id,
    type: row.type,
    content: row.content.substring(0, 500),
    source_file: row.source_file,
    concepts: JSON.parse(row.concepts || '[]') as string[],
    score: normalizeFtsScore(row.rank),
    source: 'fts' as const,
  }));

  // Normalize vector scores (ChromaDB distances: lower = better → invert)
  const normalizedVectorResults = vecResults.map((result) => ({
    ...result,
    score: 1 - (result.score || 0),
  }));

  const combinedResults = combineResults(ftsResults, normalizedVectorResults);
  const totalMatches = combinedResults.length;
  const results = combinedResults.slice(offset, offset + limit);

  const ftsCount = results.filter((r) => r.source === 'fts').length;
  const vectorCount = results.filter((r) => r.source === 'vector').length;
  const hybridCount = results.filter((r) => r.source === 'hybrid').length;
  const searchTime = Date.now() - startTime;

  const metadata: {
    mode: string;
    limit: number;
    offset: number;
    total: number;
    ftsMatches: number;
    vectorMatches: number;
    sources: { fts: number; vector: number; hybrid: number };
    searchTime: number;
    warning?: string;
  } = {
    mode,
    limit,
    offset,
    total: totalMatches,
    ftsMatches: ftsRawResults.length,
    vectorMatches: vecResults.length,
    sources: { fts: ftsCount, vector: vectorCount, hybrid: hybridCount },
    searchTime,
  };

  if (warning) {
    metadata.warning = warning;
  }

  console.error(`[MCP:SEARCH] "${query}" (${type}, ${mode}, model=${model || 'default'}) → ${results.length} results in ${searchTime}ms`);

  try {
    logSearch(query, type, mode, results.length, searchTime, results);
  } catch (e) {
    console.error('[MCP:SEARCH] Failed to log search to database:', e);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ results, total: results.length, query, metadata }, null, 2)
    }]
  };
}
