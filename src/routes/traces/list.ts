import { Elysia } from 'elysia';
import { listTenantTraces } from './tenant-scope.ts';
import { listQuery, parsePagination, parseTraceStatus, trimmedString } from './model.ts';

export const tracesListRoute = new Elysia().get('/api/traces', ({ query, set }) => {
  const status = parseTraceStatus(query.status);
  if (status === null) {
    set.status = 400;
    return { error: 'Invalid status (raw|reviewed|distilling|distilled)' };
  }
  const page = parsePagination(query);
  if ('error' in page) {
    set.status = 400;
    return { error: page.error };
  }

  return listTenantTraces({
    query: trimmedString(query.query) || undefined,
    status,
    project: trimmedString(query.project) || undefined,
    limit: page.limit,
    offset: page.offset,
  });
}, {
  query: listQuery,
  detail: {
    tags: ['traces'],
    menu: { group: 'main', path: '/traces', order: 50 },
    summary: 'List traces',
  },
});
