/**
 * GET /api/search — hybrid/FTS/vector search with input sanitization.
 */

import { Elysia } from 'elysia';
import { handleSearch } from '../../server/handlers.ts';
import { SearchQuery } from './model.ts';
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
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '10')));
    const offset = Math.max(0, parseInt(query.offset ?? '0'));
    const mode = (query.mode ?? 'hybrid') as 'hybrid' | 'fts' | 'vector';
    const project = query.project;
    const cwd = query.cwd;
    const model = query.model;

    try {
      const result = handleTenantSearch(sanitizedQ, type, limit, offset)
        ?? await handleSearch(sanitizedQ, type, limit, offset, mode, project, cwd, model);
      return { ...result, query: sanitizedQ };
    } catch {
      set.status = 400;
      return { results: [], total: 0, query: sanitizedQ, error: 'Search failed' };
    }
  },
  {
    query: SearchQuery,
    detail: {
      tags: ['search'],
      menu: { group: 'main', order: 10 },
      summary: 'Hybrid search over oracle docs',
    },
  },
);
