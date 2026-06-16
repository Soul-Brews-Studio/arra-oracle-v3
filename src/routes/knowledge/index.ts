/**
 * Knowledge Routes (Elysia) — composes /api/{learn,handoff,inbox}.
 *
 * Malformed JSON parse failures should surface as 400 Bad Request through
 * Elysia's default handling or the global structured error middleware.
 */

import { Elysia } from 'elysia';
import { createLearnCrudRoutes, createLearnListRoutes } from '../learn/index.ts';
import { handoffEndpoint } from './handoff.ts';
import { inboxEndpoint } from './inbox.ts';

export const knowledgeRoutes = new Elysia({ prefix: '/api' })
  .use(createLearnListRoutes())
  .use(createLearnCrudRoutes())
  .use(handoffEndpoint)
  .use(inboxEndpoint);
