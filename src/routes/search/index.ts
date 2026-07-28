/**
 * Search Routes (Elysia) — composes /api/{search,reflect,list}.
 *
 * Vector-only endpoints (similar, map, map3d, compare) live in
 * src/routes/vector/ since #1071 phase 1.1.
 */

import { Elysia } from 'elysia';
import { searchEndpoint } from './search.ts';
import { reflectEndpoint } from './reflect.ts';
import { listEndpoint } from './list.ts';

export const searchRoutes = new Elysia({ prefix: '/api' })
  .use(searchEndpoint)
  .use(reflectEndpoint)
  .use(listEndpoint);
