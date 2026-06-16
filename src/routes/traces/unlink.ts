import { Elysia } from 'elysia';
import { unlinkTenantTraces } from './tenant-scope.ts';
import { traceIdParam, unlinkQuery } from './model.ts';

export const traceUnlinkRoute = new Elysia().delete('/api/traces/:id/link', async ({ params, query, set }) => {
  try {
    const direction = query.direction as 'prev' | 'next';
    if (!direction || !['prev', 'next'].includes(direction)) {
      set.status = 400;
      return { error: 'Missing or invalid direction (prev|next)' };
    }
    const result = unlinkTenantTraces(params.id, direction);
    if (!result.success) {
      set.status = 400;
      return { error: result.message };
    }
    return result;
  } catch (err) {
    console.error('Unlink traces error:', err);
    set.status = 500;
    return { error: 'Failed to unlink traces' };
  }
}, {
  params: traceIdParam,
  query: unlinkQuery,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Unlink traces in a direction',
  },
});
