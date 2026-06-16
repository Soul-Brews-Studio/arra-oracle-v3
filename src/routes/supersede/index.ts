/**
 * Supersede Routes (Elysia) — composes /api/supersede (GET/POST) + /api/supersede/chain/:path.
 */

import { Elysia } from 'elysia';
import { supersedeListEndpoint } from './list.ts';
import { supersedeChainEndpoint } from './chain.ts';
import { supersedeCreateEndpoint, supersedeDocumentEndpoint } from './create.ts';

export const supersedeRoutes = new Elysia({ prefix: '/api' })
  .use(supersedeListEndpoint)
  .use(supersedeChainEndpoint)
  .use(supersedeCreateEndpoint)
  .use(supersedeDocumentEndpoint);
