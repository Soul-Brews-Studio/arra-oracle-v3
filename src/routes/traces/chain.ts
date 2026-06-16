import { Elysia } from 'elysia';
import { getTenantTrace, getTenantTraceChain } from './tenant-scope.ts';
import { traceIdParam, chainQuery, parseChainDirection } from './model.ts';

export const traceChainRoute = new Elysia().get('/api/traces/:id/chain', ({ params, query, set }) => {
  const direction = parseChainDirection(query.direction);
  if (!direction) {
    set.status = 400;
    return { error: 'Invalid direction (up|down|both)' };
  }
  if (!getTenantTrace(params.id)) {
    set.status = 404;
    return { error: 'Trace not found' };
  }
  return getTenantTraceChain(params.id, direction);
}, {
  params: traceIdParam,
  query: chainQuery,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Get causal chain for a trace',
  },
});
