import { Elysia } from 'elysia';
import { linkTenantTraces } from './tenant-scope.ts';
import { traceIdParam, linkBody } from './model.ts';

export const traceLinkRoute = new Elysia().post('/api/traces/:id/link', async ({ params, body, set }) => {
  try {
    const { nextId } = (body as any) ?? {};
    if (!nextId) {
      set.status = 400;
      return { error: 'Missing nextId in request body' };
    }
    const result = linkTenantTraces(params.id, nextId);
    if (!result.success) {
      set.status = 400;
      return { error: result.message };
    }
    return result;
  } catch (err) {
    console.error('Link traces error:', err);
    set.status = 500;
    return { error: 'Failed to link traces' };
  }
}, {
  params: traceIdParam,
  body: linkBody,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Link two traces',
  },
});
