import { Elysia } from 'elysia';
import { listTenantTraces } from './tenant-scope.ts';
import { listQuery } from './model.ts';

export const tracesListRoute = new Elysia().get('/api/traces', ({ query }) => {
  const limit = parseInt(query.limit || '50');
  const offset = parseInt(query.offset || '0');

  return listTenantTraces({
    query: query.query || undefined,
    status: (query.status as 'raw' | 'reviewed' | 'distilled' | undefined) || undefined,
    project: query.project || undefined,
    limit,
    offset,
  });
}, {
  query: listQuery,
  detail: {
    tags: ['traces'],
    menu: { group: 'main', path: '/traces', order: 50 },
    summary: 'List traces',
  },
});
