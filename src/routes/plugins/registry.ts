import { Elysia } from 'elysia';
import type { LoadedPluginRegistryEntry } from '../../plugins/registry.ts';
import { basePluginDir, scanPlugins } from './model.ts';
import { readPluginEnabled } from './state.ts';
import { hasTenantPluginScope, tenantScopedPluginDir } from './tenant.ts';

export interface PluginsRegistryRouteOptions {
  dir?: string;
  registry?: () => LoadedPluginRegistryEntry[];
}

export function createPluginsRegistryRoute(options: PluginsRegistryRouteOptions = {}) {
  return new Elysia().get('/api/plugins', () => {
    const dir = tenantScopedPluginDir(options.dir ?? basePluginDir());
    if (!options.registry || hasTenantPluginScope()) return scanPlugins(dir);
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
