/**
 * GET /api/list — paginated document listing with optional type filter.
 */

import { Elysia } from 'elysia';
import { handleList } from '../../server/handlers.ts';
import { ListQuery } from './model.ts';
import { handleTenantList } from './tenant-search.ts';

export const listEndpoint = new Elysia().get(
  '/list',
  ({ query }) => {
    const type = query.type ?? 'all';
    const limit = Math.min(1000, Math.max(1, parseInt(query.limit ?? '10')));
    const offset = Math.max(0, parseInt(query.offset ?? '0'));
    const group = query.group !== 'false';
    return handleTenantList(type, limit, offset, group) ?? handleList(type, limit, offset, group);
  },
  {
    query: ListQuery,
    detail: {
      tags: ['search'],
      menu: { group: 'main', path: '/feed', order: 20 },
      summary: 'List oracle documents',
    },
  },
);
