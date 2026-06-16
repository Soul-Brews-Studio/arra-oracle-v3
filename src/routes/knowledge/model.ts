/**
 * TypeBox schemas for knowledge routes.
 */

import { t } from 'elysia';

const ConceptInput = t.Optional(t.Union([t.Array(t.String()), t.String()]));

export const LearnBody = t.Object({
  pattern: t.Optional(t.String()),
  source: t.Optional(t.String()),
  concepts: ConceptInput,
  origin: t.Optional(t.Nullable(t.String())),
  project: t.Optional(t.Nullable(t.String())),
  cwd: t.Optional(t.String()),
});

export const HandoffBody = t.Object({
  content: t.Optional(t.String({ minLength: 1 })),
  slug: t.Optional(t.String()),
});

export const InboxQuery = t.Object({
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  type: t.Optional(t.String()),
});
