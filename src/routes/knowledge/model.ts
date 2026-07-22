/**
 * TypeBox schemas for knowledge routes.
 */

import { t } from 'elysia';

// Fields kept optional at the schema level — learn.ts / handoff.ts already
// enforce required-ness with their own 400 error messages; this layer only
// upgrades "anything goes" (t.Any()) to "if present, must be the right type."
export const LearnBody = t.Object({
  pattern: t.Optional(t.String()),
  source: t.Optional(t.String()),
  concepts: t.Optional(t.Array(t.String())),
  origin: t.Optional(t.String()),
  project: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
  traceId: t.Optional(t.String()),
});

export const HandoffBody = t.Object({
  content: t.Optional(t.String()),
  slug: t.Optional(t.String()),
});

export const InboxQuery = t.Object({
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  type: t.Optional(t.String()),
});
