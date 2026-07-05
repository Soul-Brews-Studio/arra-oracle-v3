import { t } from 'elysia';

export const AskBody = t.Object({
  q: t.Optional(t.String()),
  question: t.Optional(t.String()),
  type: t.Optional(t.String()),
  limit: t.Optional(t.Number()),
  project: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
  model: t.Optional(t.String()),
  asOf: t.Optional(t.String()),
  llm: t.Optional(t.Boolean()),
});
