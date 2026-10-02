import { detectProject } from '../project-detect.ts';
import { sqlite, isDbLockError } from '../../db/index.ts';
import { VECTOR_URL } from '../../config.ts';
import { logSearch, logDocumentAccess } from '../logging.ts';
import type { SearchResult, SearchResponse } from '../types.ts';
import { ensureVectorStoreConnected, EMBEDDING_MODELS, getVectorStoreConfigByModel } from '../../vector/factory.ts';
import { localVectorOperations } from '../vector-operations.ts';
import { createVectorProxy } from '../vector-proxy.ts';
import { localNativeVectorDisabledReason, localVectorIndexMissingReason, logLocalVectorDisabled, noteLocalVectorEnabled } from '../../vector/cpu-capabilities.ts';
import { isVectorSectionEnabled } from '../../vector/config.ts';
import { candidatePoolSize } from '../../search/retrieve-depth.ts';
import { buildFtsQuery, runFtsGet, runFtsAll, normalizeRank, combineSearchResults } from './search-helpers.ts';
const vectorProxy = createVectorProxy(VECTOR_URL);

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
  const ftsQuery = buildFtsQuery(query);
  const retrieveDepth = candidatePoolSize(limit);
  if (!ftsQuery) {
    return { results: [], total: 0, limit, offset, query };
  }

  let warning: string | undefined;
  const requestedMode = mode;
  let effectiveMode = mode;
  let vectorDisabledReason: string | undefined;
  let vectorIndexMissingReason: string | undefined;
  let vectorSectionDisabled = false;
  if (mode !== 'fts' && !vectorProxy) {
    const modelsToCheck = model === 'multi' ? ['bge-m3', 'nomic'] : [model];
    for (const modelKey of modelsToCheck) {
      const cfg = getVectorStoreConfigByModel(modelKey);
      vectorDisabledReason = localNativeVectorDisabledReason(cfg.type);
      if (vectorDisabledReason) break;
      vectorIndexMissingReason = localVectorIndexMissingReason(cfg);
      if (vectorIndexMissingReason) break;
    }
    if (vectorDisabledReason) {
      effectiveMode = 'fts';
      warning = `${vectorDisabledReason}; falling back to FTS5-only results`;
      logLocalVectorDisabled(vectorDisabledReason);
    } else {
      // Native gate passed — re-arm the disabled-warning latch (de-latch) so a
      // later transient disable logs afresh, not suppressed by a stale reason.
      noteLocalVectorEnabled();
      if (!isVectorSectionEnabled()) {
        vectorSectionDisabled = true;
        effectiveMode = 'fts';
      } else if (vectorIndexMissingReason) {
        effectiveMode = 'fts';
      }
    }
  }

  // FTS5 search (skip only when the effective mode is vector-only)
  let ftsResults: SearchResult[] = [];
  let ftsTotal = 0;

  // Project filter: if project specified, include project + universal (NULL)
  // If no project, return ALL documents (no filter)
  const projectFilter = resolvedProject
    ? '(d.project = ? OR d.project IS NULL)'
    : '1=1';
  const projectParams = resolvedProject ? [resolvedProject] : [];

  // FTS5 search must use raw SQL (Drizzle doesn't support virtual tables)
  if (effectiveMode !== 'vector') {
    if (type === 'all') {
      const countStmt = sqlite.prepare(`
        SELECT COUNT(*) as total
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}
      `);
      ftsTotal = (runFtsGet(countStmt, [ftsQuery, ...projectParams]) as { total: number } | null)?.total ?? 0;

      const stmt = sqlite.prepare(`
        SELECT f.id, (SELECT content FROM oracle_content WHERE rowid = f.rowid) AS content, d.type, d.source_file, d.concepts, d.project, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = runFtsAll<any>(stmt, [ftsQuery, ...projectParams, retrieveDepth]).map((row: any) => ({
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
      ftsTotal = (runFtsGet(countStmt, [ftsQuery, type, ...projectParams]) as { total: number } | null)?.total ?? 0;

      const stmt = sqlite.prepare(`
        SELECT f.id, (SELECT content FROM oracle_content WHERE rowid = f.rowid) AS content, d.type, d.source_file, d.concepts, d.project, rank as score
        FROM oracle_fts f
        JOIN oracle_documents d ON f.id = d.id
        WHERE oracle_fts MATCH ? AND d.type = ? AND ${projectFilter}
        ORDER BY rank
        LIMIT ?
      `);
      ftsResults = runFtsAll<any>(stmt, [ftsQuery, type, ...projectParams, retrieveDepth]).map((row: any) => ({
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
  let remoteVectorTotal: number | undefined;
  // Tracks whether the vector leg succeeded. Stays `true` when mode === 'fts'
  // (vector wasn't asked for), flips to `false` if the proxy is enabled and
  // the remote call failed — clients use this to render a "vector down" hint
  // while still getting FTS5 results.
  let vectorAvailable = !vectorSectionDisabled && !vectorDisabledReason && !vectorIndexMissingReason;

  // VECTOR_URL set → route the vector leg through the remote service.
  // FTS5 always runs locally above. If the proxy fails we return whatever FTS5
  // produced and set vectorAvailable: false (per VECTOR_FALLBACK = 'fts5').
  if (effectiveMode !== 'fts' && vectorProxy) {
    const remote = await vectorProxy.search({
      q: query,
      type,
      limit: retrieveDepth,
      offset: 0,
      mode: 'vector',
      project: resolvedProject ?? undefined,
      cwd,
      model,
    });
    if (remote) {
      vectorResults = remote.results || [];
      if (typeof remote.total === 'number') remoteVectorTotal = remote.total;
    } else {
      vectorAvailable = false;
      warning = 'Vector proxy unavailable — FTS5-only results';
    }
  } else if (effectiveMode !== 'fts') {
    try {
      const vector = await localVectorOperations.search({
        query,
        type,
        limit: retrieveDepth,
        project: resolvedProject,
        model,
      });
      vectorResults = vector.results;
      if (vectorResults.length > 0) {
        console.log(`[Vector] ${vectorResults.length} results, top scores: ${vectorResults.slice(0, 3).map(r => r.score?.toFixed(3))}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Vector Search Error]', msg);
      if (!warning) warning = `Vector search error: ${msg}`;
    }
  }

  // Combine results using hybrid ranking
  const combined = combineSearchResults(ftsResults, vectorResults);
  // For vector-only mode, ftsTotal is 0 and combined.length is just top-N,
  // so use the vector collection count as the total for accurate display
  let total = Math.max(ftsTotal, combined.length);
  if (requestedMode === 'vector' && vectorProxy && remoteVectorTotal !== undefined) {
    total = remoteVectorTotal;
  } else if (requestedMode === 'vector' && vectorResults.length > 0) {
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
  logSearch(query, type, requestedMode, total, searchTime, results, resolvedProject ?? undefined);
  results.forEach(r => logDocumentAccess(r.id, 'search', resolvedProject ?? undefined));

  return {
    results,
    total,
    offset,
    limit,
    mode: requestedMode,
    ...(model === 'multi' ? { model: 'multi' } : model && EMBEDDING_MODELS[model] ? { model } : {}),
    ...(requestedMode !== 'fts' ? { vectorAvailable } : {}),
    ...(warning && { warning })
  };
}
