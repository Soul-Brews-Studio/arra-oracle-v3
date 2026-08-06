import { Elysia } from 'elysia';
import { getTenantTrace } from './tenant-scope.ts';
import { traceIdParam } from './model.ts';

export const traceGetRoute = new Elysia().get('/api/traces/:id', ({ params, set }) => {
  const trace = getTenantTrace(params.id);
  if (!trace) {
    set.status = 404;
    return { error: 'Trace not found' };
  }
  return trace;
}, {
  params: traceIdParam,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Get a single trace',
  },
});
