import { detectProject } from '../../server/project-detect.ts';
import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { rerankByEntityLinks } from '../../search/entity-ranking.ts';
import { queryPointerIndex } from '../../search/pointer-index.ts';
import { rerankCandidates } from '../../server/reranker.ts';
import type { SearchResult } from '../../server/types.ts';
import { compactSearchResults, parseSearchRetrievalMode } from '../../search/compact-summary.ts';
import { candidatePoolSize } from '../../search/retrieve-depth.ts';
import { isVectorSectionEnabled } from '../../vector/config.ts';
import type { ToolContext, ToolResponse, OracleSearchInput } from '../types.ts';
import { applyEntityLinkBoost, hasEntityLinkSearchHook, queryEntityLinks } from './entities.ts';
import { searchFts, mapFtsResults, enrichSupersedeFlags } from './fts.ts';
import { attachSearchEvidence, combineResults, sanitizeFtsQuery } from './helpers.ts';
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
  const retrieval = parseSearchRetrievalMode(input.retrieval);
  if (!retrieval.ok) throw new Error(retrieval.error);

  const augmentedQuery = augmentQueryWithAcronyms(query);
  const safeQuery = sanitizeFtsQuery(augmentedQuery);
  const retrieveDepth = candidatePoolSize(limit);
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
      ftsRawResults = searchFts(ctx, safeQuery, type, retrieveDepth, resolvedProject);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      warning = `FTS5 keyword search unavailable: ${errorMessage}`;
      console.error('[FTS5]', errorMessage);
    }
  }

  const pointerResults = queryPointerIndex(ctx.sqlite, {
    query: augmentedQuery,
    type,
    limit: retrieveDepth,
    project: resolvedProject,
    tenantId: currentTenantId(),
  });

  let vecResults: Awaited<ReturnType<typeof vectorSearch>> = [];
  if (effectiveMode !== 'fts') {
    try {
      vecResults = await vectorSearch(ctx, augmentedQuery, type, retrieveDepth, model);
    } catch (error) {
      vectorSearchError = true;
      vectorAvailable = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Vector]', errorMessage);
      warning = `Vector search unavailable: ${errorMessage}. Using FTS5 only.`;
    }
    if (vecResults.length === 0 && !vectorSearchError) {
      warning ||= 'Vector search returned no results. Using FTS5 results.';
    }
  }

  const ftsResults = mapFtsResults(ftsRawResults);
  const normalizedVectorResults = vecResults.map((result) => ({ ...result, score: 1 - (result.score || 0) }));
  const combinedResults = combineResults(ftsResults, normalizedVectorResults, 0.5, 0.5, pointerResults);
  const entityRankedResults = rerankByEntityLinks(ctx.sqlite, combinedResults, augmentedQuery, currentTenantId());
  const reranked = await rerankCandidates({
    query,
    candidates: entityRankedResults.slice(0, retrieveDepth),
    getText: (result) => result.content,
  });
  const finalResults = reranked.reranked
    ? [...reranked.results, ...entityRankedResults.slice(retrieveDepth)]
    : entityRankedResults;
  const hasEntityHook = hasEntityLinkSearchHook(ctx);
  const entityLinksEnabled = requestedMode !== 'fts' && (effectiveMode !== 'fts' || hasEntityHook);
  let entityLinkHits: Awaited<ReturnType<typeof queryEntityLinks>> = [];
  let entityLinkWarning: string | undefined;
  if (entityLinksEnabled && finalResults.length > 0) {
    try {
      entityLinkHits = await queryEntityLinks(ctx, augmentedQuery, retrieveDepth, model);
    } catch (error) {
      entityLinkWarning = error instanceof Error ? error.message : String(error);
      console.error('[EntityLinkSearch]', entityLinkWarning);
    }
  }
  const entityBoost = applyEntityLinkBoost(finalResults, entityLinkHits);
  const totalMatches = entityBoost.results.length;
  let results: Array<Record<string, unknown>> = attachSearchEvidence(entityBoost.results.slice(offset, offset + limit));
  enrichSupersedeFlags(ctx, results);
  const compact = retrieval.mode === 'compact-summary' ? compactSearchResults(results, query) : null;
  if (compact) results = compact.results;

  const ftsCount = results.filter((result) => result.source === 'fts').length;
  const vectorCount = results.filter((result) => result.source === 'vector').length;
  const hybridCount = results.filter((result) => result.source === 'hybrid').length;
  const searchTime = Date.now() - startTime;
  const metadata = {
    mode,
    limit,
    retrieveDepth,
    offset,
    total: totalMatches,
    ftsMatches: ftsRawResults.length,
    vectorMatches: vecResults.length,
    sources: { fts: ftsCount, vector: vectorCount, hybrid: hybridCount },
    searchTime,
    pointerIndex: {
      enabled: true,
      strategy: 'topic_entity_date_pointer_fast_path',
      hits: pointerResults.length,
    },
    ...(requestedMode !== 'fts' ? { vectorAvailable: vectorAvailable === true } : {}),
    reranked: reranked.reranked,
    ...(reranked.fallbackReason ? { rerankFallbackReason: reranked.fallbackReason } : {}),
    ...(entityLinksEnabled ? {
      entityLinks: {
        enabled: true,
        strategy: 'entity-link-sidecar-rank-boost',
        graph: false,
        hits: entityLinkHits.length,
        boosted: entityBoost.boosted,
        ...(entityLinkWarning ? { warning: entityLinkWarning } : {}),
      },
    } : {}),
    ...(compact ? { retrieval: compact.metadata } : {}),
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
