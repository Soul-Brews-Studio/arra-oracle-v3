/** Canonical /api/plugins router — dual-layout scanner (nested + flat). */
import { Elysia } from 'elysia';
import { pluginsListRoute } from './list.ts';
import { pluginGetByNameRoute } from './get-by-name.ts';

export const pluginsRouter = new Elysia()
  .use(pluginsListRoute)
  .use(pluginGetByNameRoute);
