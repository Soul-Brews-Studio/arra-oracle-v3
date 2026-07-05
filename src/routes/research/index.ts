import { Elysia, t } from 'elysia';
import { buildResearchNoteLearning } from '../../research/note.ts';
import { createLearning, type LearnCreateBody } from '../learn/crud.ts';

const EvidenceBody = t.Object({
  path: t.Optional(t.String()),
  title: t.Optional(t.String()),
  url: t.Optional(t.String()),
  summary: t.Optional(t.String()),
});

const ResearchNoteBody = t.Object({
  title: t.Optional(t.String()),
  question: t.Optional(t.String()),
  recommendation: t.Optional(t.String()),
  repo: t.Optional(t.String()),
  issue: t.Optional(t.Number()),
  repoEvidence: t.Optional(t.Array(EvidenceBody)),
  externalSources: t.Optional(t.Array(EvidenceBody)),
  hypotheses: t.Optional(t.Array(t.String())),
  implementationPlan: t.Optional(t.Array(t.String())),
  verificationPlan: t.Optional(t.Array(t.String())),
  openQuestions: t.Optional(t.Array(t.String())),
  concepts: t.Optional(t.Array(t.String())),
  source: t.Optional(t.String()),
  project: t.Optional(t.String()),
});

export function createResearchRoutes() {
  return new Elysia({ prefix: '/api' }).post('/research/note', ({ body, set }) => {
    const note = buildResearchNoteLearning((body ?? {}) as Record<string, unknown>);
    if (!note.success) {
      set.status = 400;
      return { success: false, error: note.error };
    }
    const result = createLearning({
      pattern: note.pattern,
      source: note.source,
      concepts: note.concepts,
      origin: 'thor-oracle',
      project: note.project,
    } satisfies LearnCreateBody);
    set.status = result.status;
    return result.body;
  }, {
    body: ResearchNoteBody,
    detail: {
      tags: ['knowledge'],
      menu: { group: 'hidden' },
      summary: 'Store a Thor Stormforge research note as a learning',
    },
  });
}

export const researchRoutes = createResearchRoutes();
