import { Elysia } from 'elysia';
import type { LoadedPluginRegistryEntry } from '../../plugins/registry.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { currentPluginDir, scanPlugins, scopedPluginDir } from './model.ts';
import { readPluginEnabled } from './state.ts';

export interface PluginsRegistryRouteOptions {
  dir?: string;
  registry?: () => LoadedPluginRegistryEntry[];
}

export function createPluginsRegistryRoute(options: PluginsRegistryRouteOptions = {}) {
  return new Elysia().get('/api/plugins', () => {
    const dir = options.dir ? scopedPluginDir(options.dir) : currentPluginDir();
    if (!options.registry || currentTenantId()) return scanPlugins(dir);
    const plugins = options.registry().map((plugin) => ({
      ...plugin,
      enabled: readPluginEnabled(plugin.name) ?? plugin.enabled ?? true,
    }));
    return { plugins, count: plugins.length, dir };
  }, {
    detail: {
      tags: ['plugins'],
      menu: { group: 'main', order: 70 },
      summary: 'List loaded plugins',
    },
  });
}

export const pluginsRegistryRoute = createPluginsRegistryRoute();
