/**
 * GET /api/search — hybrid/FTS/vector search with input sanitization.
 */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import { filterResultsAsOf, parseAsOf } from '../../search/bitemporal.ts';
import { compactSearchResults, parseSearchRetrievalMode } from '../../search/compact-summary.ts';
import { rerankByEntityLinks } from '../../search/entity-ranking.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import { handleSearch } from '../../server/handlers.ts';
import { asOfResponse } from './asof.ts';
import { SearchQuery } from './model.ts';
import { parseOptionalSearchModel } from './model-key.ts';
import { parseOffset, parsePositiveInt, parseSearchMode } from './query.ts';
import { handleTenantSearch } from './tenant-search.ts';

export const searchEndpoint = new Elysia().get(
  '/search',
  async ({ query, set }) => {
    const q = query.q;
    if (!q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }

    const sanitizedQ = q
      .replace(/<[^>]*>/g, '')
      .replace(/[\x00-\x1f]/g, '')
      .trim();
    if (!sanitizedQ) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const type = query.type ?? 'all';
    const limit = parsePositiveInt(query.limit, 10, 100);
    const offset = parseOffset(query.offset);
    const mode = parseSearchMode(query.mode);
    if (!mode) {
      set.status = 400;
      return { error: 'Invalid search mode. Expected one of: hybrid, fts, vector' };
    }
    const retrieval = parseSearchRetrievalMode(query.retrieval);
    if (!retrieval.ok) {
      set.status = 400;
      return { error: retrieval.error };
    }
    const asOf = parseAsOf(query.asOf);
    if (!asOf.ok) {
      set.status = 400;
      return { error: asOf.error };
    }
    const project = query.project;
    const cwd = query.cwd;
    const parsedModel = parseOptionalSearchModel(query.model);
    if (!parsedModel.ok) {
      set.status = 400;
      return { error: parsedModel.error };
    }
    const model = parsedModel.value;

    try {
      const augmentedQ = augmentQueryWithAcronyms(sanitizedQ);
      const tenantResult = handleTenantSearch(augmentedQ, type, limit, offset, asOf.value);
      const result = tenantResult ?? await handleSearch(augmentedQ, type, limit, offset, mode, project, cwd, model);
      if (asOf.value && !tenantResult) {
        result.results = filterResultsAsOf(
          sqlite,
          result.results as unknown as Array<Record<string, unknown>>,
          asOf.value,
        ) as unknown as typeof result.results;
        result.total = result.results.length;
      }
      result.results = rerankByEntityLinks(sqlite, result.results, augmentedQ, currentTenantId());
      attachSupersedeStatus(sqlite, result.results as unknown as Array<Record<string, unknown>>);
      const compact = retrieval.mode === 'compact-summary'
        ? compactSearchResults(result.results as unknown as Array<Record<string, unknown>>, sanitizedQ)
        : null;
      if (compact) result.results = compact.results as unknown as typeof result.results;
      const metadata = compact ? { metadata: { ...('metadata' in result ? result.metadata as object : {}), retrieval: compact.metadata } } : {};
      return { ...result, ...metadata, query: sanitizedQ, ...asOfResponse(asOf.value) };
    } catch {
      set.status = 400;
      return { results: [], total: 0, query: sanitizedQ, error: 'Search failed' };
    }
  },
  {
    query: SearchQuery,
    detail: {
      tags: ['search'],
      menu: { group: 'main', path: '/search', order: 10 },
      summary: 'Hybrid search over oracle docs with optional asOf valid-time filtering',
    },
  },
);
