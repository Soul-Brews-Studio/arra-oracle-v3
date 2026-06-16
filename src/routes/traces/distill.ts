import { Elysia, t } from 'elysia';
import { distillTraceAwakening } from '../../trace/distill.ts';
import { getTrace } from '../../trace/handler.ts';
import { traceIdParam } from './model.ts';

const distillBody = t.Object({
  awakening: t.String({ minLength: 1 }),
  promoteToLearning: t.Optional(t.Boolean()),
});

export const traceDistillRoute = new Elysia().post('/api/traces/:id/distill', ({ params, body, set }) => {
  const awakening = body.awakening.trim();
  if (!awakening) {
    set.status = 400;
    return { error: 'awakening is required' };
  }
  if (!getTrace(params.id)) {
    set.status = 404;
    return { error: 'Trace not found' };
  }
  return distillTraceAwakening({
    traceId: params.id,
    awakening,
    promoteToLearning: body.promoteToLearning,
  });
}, {
  params: traceIdParam,
  body: distillBody,
  detail: {
    tags: ['traces'],
    menu: { group: 'hidden' },
    summary: 'Distill an awakening insight from a trace',
  },
});
