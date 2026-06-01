/**
 * TypeBox schemas for supersede routes.
 */

import { t } from 'elysia';

export const SupersedeQuery = t.Object({
  project: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const SupersedeBody = t.Any();

export const SupersedeDocumentBody = t.Any();
