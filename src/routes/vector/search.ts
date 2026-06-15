/** GET /api/vector/search — vector-mode search alias for routed vector clients. */
import { Elysia } from 'elysia';
import { handleSearch } from '../../server/handlers.ts';
import { SearchQuery } from '../search/model.ts';

function sanitize(query: string): string {
  return query
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
}

export const vectorSearchEndpoint = new Elysia().get(
  '/vector/search',
  async ({ query, set }) => {
    if (!query.q) {
      set.status = 400;
      return { error: 'Missing query parameter: q' };
    }
    const sanitizedQ = sanitize(query.q);
    if (!sanitizedQ) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const type = query.type ?? 'all';
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '10')));
    const offset = Math.max(0, parseInt(query.offset ?? '0'));
    try {
      const result = await handleSearch(
        sanitizedQ,
        type,
        limit,
        offset,
        'vector',
        query.project,
        query.cwd,
        query.model,
      );
      return { ...result, query: sanitizedQ };
    } catch {
      set.status = 400;
      return { results: [], total: 0, query: sanitizedQ, error: 'Vector search failed' };
    }
  },
  {
    query: SearchQuery,
    detail: {
      tags: ['vector'],
      menu: { group: 'hidden' },
      summary: 'Vector-mode search under the vector route namespace',
    },
  },
);
