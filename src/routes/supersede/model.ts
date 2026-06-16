/**
 * TypeBox schemas for supersede routes.
 */

import { t } from 'elysia';

export const SupersedeQuery = t.Object({
  project: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const SupersedeBody = t.Object({
  old_path: t.Optional(t.String({ minLength: 1 })),
  old_id: t.Optional(t.String()),
  old_title: t.Optional(t.String()),
  old_type: t.Optional(t.String()),
  new_path: t.Optional(t.String()),
  new_id: t.Optional(t.String()),
  new_title: t.Optional(t.String()),
  reason: t.Optional(t.String()),
  superseded_by: t.Optional(t.String()),
  project: t.Optional(t.String()),
});
