import { Elysia, t } from 'elysia';
import { distillTraceAwakening } from '../../trace/distill.ts';
import { getTenantTrace } from './tenant-scope.ts';
import { traceIdParam } from './model.ts';

const evidenceBody = t.Object({
  path: t.Optional(t.String()),
  title: t.Optional(t.String()),
  url: t.Optional(t.String()),
  summary: t.String(),
});

const findingBody = t.Object({
  issue: t.Optional(t.Number()),
  repo: t.Optional(t.String()),
  title: t.Optional(t.String()),
  question: t.Optional(t.String()),
  repoEvidence: t.Optional(t.Array(evidenceBody)),
  externalSources: t.Optional(t.Array(evidenceBody)),
  hypotheses: t.Optional(t.Array(t.String())),
  recommendation: t.Optional(t.String()),
  implementationPlan: t.Optional(t.Array(t.String())),
  verificationPlan: t.Optional(t.Array(t.String())),
  openQuestions: t.Optional(t.Array(t.String())),
});

const distillBody = t.Object({
  awakening: t.String({ minLength: 1 }),
  promoteToLearning: t.Optional(t.Boolean()),
  oracle: t.Optional(t.String()),
  theme: t.Optional(t.String()),
  concepts: t.Optional(t.Array(t.String())),
  source: t.Optional(t.String()),
  finding: t.Optional(findingBody),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
});

export const traceDistillRoute = new Elysia().post('/api/traces/:id/distill', ({ params, body, set }) => {
  const awakening = body.awakening.trim();
  if (!awakening) {
    set.status = 400;
    return { error: 'awakening is required' };
  }
  if (!getTenantTrace(params.id)) {
    set.status = 404;
    return { error: 'Trace not found' };
  }
  return distillTraceAwakening({
    traceId: params.id,
    awakening,
    promoteToLearning: body.promoteToLearning,
    oracle: body.oracle,
    theme: body.theme,
    concepts: body.concepts,
    source: body.source,
    finding: body.finding,
    metadata: body.metadata,
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
