import { t } from 'elysia';

export const FeedQuery = t.Object({
  limit: t.Optional(t.String()),
  oracle: t.Optional(t.String()),
  event: t.Optional(t.String()),
  since: t.Optional(t.String()),
});

export const CreateFeedBody = t.Object({
  oracle: t.Optional(t.String()),
  event: t.Optional(t.String()),
  project: t.Optional(t.String()),
  session_id: t.Optional(t.String()),
  message: t.Optional(t.String()),
});

export type { FeedEvent } from '../../feed/events.ts';
