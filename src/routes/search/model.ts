/**
 * TypeBox schemas for search routes (FTS / hybrid).
 *
 * Vector-only schemas (SimilarQuery, Map3dQuery, CompareQuery) live in
 * src/routes/vector/model.ts.
 */

import { t } from 'elysia';

export const SearchQuery = t.Object({
  q: t.Optional(t.String()),
  type: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  mode: t.Optional(t.String()),
  project: t.Optional(t.String()),
  cwd: t.Optional(t.String()),
  model: t.Optional(t.String()),
});

export const ListQuery = t.Object({
  type: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  group: t.Optional(t.String()),
});
