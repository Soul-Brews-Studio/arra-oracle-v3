import { Elysia } from 'elysia';
import type { LoadedPluginRegistryEntry } from '../../plugins/registry.ts';
import { currentPluginDir, scanPlugins } from './model.ts';
import { readPluginEnabled } from './state.ts';

export interface PluginsRegistryRouteOptions {
  dir?: string;
  registry?: () => LoadedPluginRegistryEntry[];
}

export function createPluginsRegistryRoute(options: PluginsRegistryRouteOptions = {}) {
  return new Elysia().get('/api/plugins', () => {
    if (!options.registry) return scanPlugins(options.dir);
    const plugins = options.registry().map((plugin) => ({
      ...plugin,
      enabled: readPluginEnabled(plugin.name) ?? plugin.enabled ?? true,
    }));
    return { plugins, count: plugins.length, dir: options.dir ?? currentPluginDir() };
  }, {
    detail: {
      tags: ['plugins'],
      menu: { group: 'main', order: 70 },
      summary: 'List loaded plugins',
    },
  });
}

export const pluginsRegistryRoute = createPluginsRegistryRoute();
