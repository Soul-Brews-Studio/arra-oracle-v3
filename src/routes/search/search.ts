/**
 * GET /api/search — hybrid/FTS/vector search with input sanitization.
 */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { filterResultsAsOf, parseAsOf } from '../../search/bitemporal.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import { handleSearch } from '../../server/handlers.ts';
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
      const tenantResult = handleTenantSearch(sanitizedQ, type, limit, offset, asOf.value);
      const result = tenantResult ?? await handleSearch(sanitizedQ, type, limit, offset, mode, project, cwd, model);
      if (asOf.value && !tenantResult) {
        result.results = filterResultsAsOf(
          sqlite,
          result.results as unknown as Array<Record<string, unknown>>,
          asOf.value,
        ) as unknown as typeof result.results;
        result.total = result.results.length;
      }
      attachSupersedeStatus(sqlite, result.results as unknown as Array<Record<string, unknown>>);
      return { ...result, query: sanitizedQ, ...(asOf.value ? { asOf: new Date(asOf.value).toISOString() } : {}) };
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
      summary: 'Hybrid search over oracle docs',
    },
  },
);
