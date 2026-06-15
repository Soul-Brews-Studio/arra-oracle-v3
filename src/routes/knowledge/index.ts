/**
 * Knowledge Routes (Elysia) — composes /api/{learn,handoff,inbox}.
 *
 * onError PARSE → 500 preserves Hono try/catch semantics (malformed JSON
 * body returned 500 via the old catch block; Elysia defaults to 400 for
 * parse errors, so we remap to match the HTTP contract tests).
 */

import { Elysia } from 'elysia';
import { createLearnCrudRoutes } from '../learn/index.ts';
import { handoffEndpoint } from './handoff.ts';
import { inboxEndpoint } from './inbox.ts';

export const knowledgeRoutes = new Elysia({ prefix: '/api' })
  .onError(({ code, error, set }) => {
    if (code === 'PARSE') {
      set.status = 500;
      return { error: error instanceof Error ? error.message : 'Parse error' };
    }
  })
  .use(createLearnCrudRoutes())
  .use(handoffEndpoint)
  .use(inboxEndpoint);
