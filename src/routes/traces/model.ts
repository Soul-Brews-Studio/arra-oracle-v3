import { t } from 'elysia';

export const traceIdParam = t.Object({ id: t.String() });

export const listQuery = t.Object({
  query: t.Optional(t.String()),
  status: t.Optional(t.String()),
  project: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const chainQuery = t.Object({
  direction: t.Optional(t.String()),
});

export const unlinkQuery = t.Object({
  direction: t.Optional(t.String()),
});

export const linkBody = t.Unknown();
