import { Elysia } from 'elysia';
import { getTenantTraceChain } from './tenant-scope.ts';
import { traceIdParam, chainQuery } from './model.ts';

export const traceChainRoute = new Elysia().get('/api/traces/:id/chain', ({ params, query }) => {
  const direction = (query.direction as 'up' | 'down' | 'both') || 'both';
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
