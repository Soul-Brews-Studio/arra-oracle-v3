/**
 * Knowledge Routes (Elysia) — composes /api/{learn,handoff,inbox}.
 *
 * Malformed JSON parse failures on /api/learn preserve the historical 500
 * contract through the structured error middleware's learn-path override.
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
