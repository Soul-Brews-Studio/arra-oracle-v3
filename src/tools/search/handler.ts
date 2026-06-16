import { detectProject } from '../../server/project-detect.ts';
import { rerankCandidates } from '../../server/reranker.ts';
import type { SearchResult } from '../../server/types.ts';
import { isVectorSectionEnabled } from '../../vector/config.ts';
import type { ToolContext, ToolResponse, OracleSearchInput } from '../types.ts';
import { searchFts, mapFtsResults, enrichSupersedeFlags } from './fts.ts';
import { combineResults, sanitizeFtsQuery } from './helpers.ts';
import { vectorSearch } from './vector.ts';

let logSearchFn: typeof import('../../server/logging.ts').logSearch | null = null;
async function loadLogSearch(): Promise<typeof import('../../server/logging.ts').logSearch> {
  logSearchFn ??= (await import('../../server/logging.ts')).logSearch;
  return logSearchFn;
}

export async function handleSearch(ctx: ToolContext, input: OracleSearchInput): Promise<ToolResponse> {
  const startTime = Date.now();
  const { query, type = 'all', limit = 5, offset = 0, mode = 'hybrid', project, cwd, model } = input;
  if (!query || query.trim().length === 0) throw new Error('Query cannot be empty');

  const safeQuery = sanitizeFtsQuery(query);
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  let warning: string | undefined;
  let vectorSearchError = false;
  const requestedMode = mode;
  let effectiveMode = mode;
  const vectorSectionEnabled = requestedMode !== 'fts' && isVectorSectionEnabled();
  let vectorAvailable = requestedMode !== 'fts' ? vectorSectionEnabled : undefined;
  if (requestedMode !== 'fts' && !vectorSectionEnabled) effectiveMode = 'fts';

  let ftsRawResults: ReturnType<typeof searchFts> = [];
  if (effectiveMode !== 'vector' && safeQuery) {
    try {
      ftsRawResults = searchFts(ctx, safeQuery, type, limit * 3, resolvedProject);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      warning = `FTS5 keyword search unavailable: ${errorMessage}`;
      console.error('[FTS5]', errorMessage);
    }
  }

  let vecResults: Awaited<ReturnType<typeof vectorSearch>> = [];
  if (effectiveMode !== 'fts') {
    try {
      vecResults = await vectorSearch(ctx, query, type, limit * 2, model);
    } catch (error) {
      vectorSearchError = true;
      vectorAvailable = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ChromaDB]', errorMessage);
      warning = `Vector search unavailable: ${errorMessage}. Using FTS5 only.`;
    }
    if (vecResults.length === 0 && !vectorSearchError) {
      warning ||= 'Vector search returned no results. Using FTS5 results.';
    }
  }

  const ftsResults = mapFtsResults(ftsRawResults);
  const normalizedVectorResults = vecResults.map((result) => ({ ...result, score: 1 - (result.score || 0) }));
  const combinedResults = combineResults(ftsResults, normalizedVectorResults);
  const reranked = await rerankCandidates({
    query,
    candidates: combinedResults.slice(0, 50),
    getText: (result) => result.content,
  });
  const finalResults = reranked.reranked
    ? [...reranked.results, ...combinedResults.slice(50)]
    : combinedResults;
  const totalMatches = finalResults.length;
  const results: Array<Record<string, unknown>> = finalResults.slice(offset, offset + limit);
  enrichSupersedeFlags(ctx, results);

  const ftsCount = results.filter((result) => result.source === 'fts').length;
  const vectorCount = results.filter((result) => result.source === 'vector').length;
  const hybridCount = results.filter((result) => result.source === 'hybrid').length;
  const searchTime = Date.now() - startTime;
  const metadata = {
    mode,
    limit,
    offset,
    total: totalMatches,
    ftsMatches: ftsRawResults.length,
    vectorMatches: vecResults.length,
    sources: { fts: ftsCount, vector: vectorCount, hybrid: hybridCount },
    searchTime,
    ...(requestedMode !== 'fts' ? { vectorAvailable: vectorAvailable === true } : {}),
    reranked: reranked.reranked,
    ...(reranked.fallbackReason ? { rerankFallbackReason: reranked.fallbackReason } : {}),
    ...(warning ? { warning } : {}),
  };

  console.error(`[MCP:SEARCH] "${query}" (${type}, ${mode}, model=${model || 'default'}) → ${results.length} results in ${searchTime}ms`);
  try {
    const logSearch = await loadLogSearch();
    logSearch(query, type, mode, results.length, searchTime, results as unknown as SearchResult[]);
  } catch (error) {
    console.error('[MCP:SEARCH] Failed to log search to database:', error);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ results, total: results.length, query, metadata }, null, 2),
    }],
  };
}
