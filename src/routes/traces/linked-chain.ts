import { Elysia } from 'elysia';
import { getTenantTrace, getTenantTraceLinkedChain } from './tenant-scope.ts';
import { traceIdParam } from './model.ts';

export const traceLinkedChainRoute = new Elysia().get('/api/traces/:id/linked-chain', async ({ params, set }) => {
  try {
    if (!getTenantTrace(params.id)) {
      set.status = 404;
      return { error: 'Trace not found' };
    }
    return getTenantTraceLinkedChain(params.id);
  } catch (err) {
    console.error('Get linked chain error:', err);
    set.status = 500;
    return { error: 'Failed to get linked chain' };
  }
}, {
  params: traceIdParam,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Walk explicit trace link graph',
  },
});
