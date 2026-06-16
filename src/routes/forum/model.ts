import { t } from 'elysia';

export const threadIdParam = t.Object({ id: t.String() });

export const threadsQuery = t.Object({
  status: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const threadCreateBody = t.Object({
  message: t.String({ minLength: 1 }),
  thread_id: t.Optional(t.Union([t.Number(), t.String()])),
  title: t.Optional(t.String()),
  role: t.Optional(t.String()),
});

export const threadStatusBody = t.Object({
  status: t.String({ minLength: 1 }),
});
