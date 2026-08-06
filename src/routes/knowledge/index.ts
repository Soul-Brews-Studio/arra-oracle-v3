/**
 * Knowledge Routes (Elysia) — composes /api/{learn,handoff,inbox}.
 *
 * Malformed JSON parse failures on /api/learn preserve the audited
 * 500 contract from the shared error middleware.
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
