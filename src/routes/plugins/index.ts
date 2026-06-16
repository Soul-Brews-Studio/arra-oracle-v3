/** Canonical /api/plugins router — dual-layout scanner (nested + flat). */
import { Elysia } from 'elysia';
import { createPluginsRegistryRoute, type PluginsRegistryRouteOptions } from './registry.ts';
import { pluginGetByNameRoute } from './get-by-name.ts';
import { pluginStateRoute } from './state.ts';

export function createPluginsRouter(options: PluginsRegistryRouteOptions = {}) {
  return new Elysia()
    .use(createPluginsRegistryRoute(options))
    .use(pluginStateRoute)
    .use(pluginGetByNameRoute);
}

export const pluginsRouter = createPluginsRouter();
