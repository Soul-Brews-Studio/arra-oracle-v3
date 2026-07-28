/**
 * TypeBox schemas for vector-only routes.
 */

import { t } from 'elysia';

export const SimilarQuery = t.Object({
  id: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  model: t.Optional(t.String()),
});

export const Map3dQuery = t.Object({
  model: t.Optional(t.String()),
});

export const CompareQuery = t.Object({
  q: t.Optional(t.String()),
  models: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  type: t.Optional(t.String()),
  project: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
});
