/** Canonical /api/plugins router — dual-layout scanner (nested + flat). */
import { Elysia } from 'elysia';
import { createPluginsRegistryRoute, type PluginsRegistryRouteOptions } from './registry.ts';
import { pluginGetByNameRoute } from './get-by-name.ts';
import { pluginStateRoute } from './state.ts';
import { canvasPluginRegistryRoute } from './canvas.ts';
import { createPluginToggleRoute, type PluginToggleRouteOptions } from './toggle.ts';

export type PluginsRouterOptions = PluginsRegistryRouteOptions & PluginToggleRouteOptions;

export function createPluginsRouter(options: PluginsRouterOptions = {}) {
  return new Elysia()
    .use(createPluginsRegistryRoute(options))
    .use(pluginStateRoute)
    .use(createPluginToggleRoute({ runtime: options.runtime, runtimeRef: options.runtimeRef }))
    .use(canvasPluginRegistryRoute)
    .use(pluginGetByNameRoute);
}

export const pluginsRouter = createPluginsRouter();
