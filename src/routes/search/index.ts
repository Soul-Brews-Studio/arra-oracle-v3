/**
 * Search Routes (Elysia) — composes /api/{search,reflect,list}.
 *
 * Vector-only endpoints (similar, map, compare) live in src/routes/vector/.
 * Map3D is mounted there too but reads from DB/FTS for the memory globe.
 */

import { Elysia } from 'elysia';
import { searchEndpoint } from './search.ts';
import { reflectEndpoint } from './reflect.ts';
import { listEndpoint } from './list.ts';
import { chainSearchEndpoint } from './chain.ts';

export const searchRoutes = new Elysia({ prefix: '/api' })
  .use(searchEndpoint)
  .use(reflectEndpoint)
  .use(listEndpoint)
  .use(chainSearchEndpoint);
