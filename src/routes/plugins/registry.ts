import { Elysia, t } from 'elysia';
import { publicMcpToolsByPlugin, type LoadedPluginRegistryEntry } from '../../plugins/registry.ts';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';
import type { UnifiedRuntimeRef } from '../../plugins/runtime-routes.ts';
import { basePluginDir, scanPlugins } from './model.ts';
import { readPluginEnabled } from './state.ts';
import { hasTenantPluginScope, tenantScopedPluginDir } from './tenant.ts';

type RegistryRuntime = Pick<UnifiedRuntime, 'mcpTools'>;

export interface PluginsRegistryRouteOptions {
  dir?: string;
  registry?: () => LoadedPluginRegistryEntry[];
  runtime?: RegistryRuntime;
  runtimeRef?: UnifiedRuntimeRef<RegistryRuntime>;
  canvasMetadataRegistry?: () => unknown | Promise<unknown>;
}

function runtimeMcpTools(options: PluginsRegistryRouteOptions) {
  const tools = options.runtimeRef?.current.mcpTools ?? options.runtime?.mcpTools;
  return tools ? publicMcpToolsByPlugin(tools) : null;
}

export function createPluginsRegistryRoute(options: PluginsRegistryRouteOptions = {}) {
  return new Elysia().get('/api/plugins', async ({ query }) => {
    if (query.kind === 'canvas') {
      if (options.canvasMetadataRegistry) return options.canvasMetadataRegistry();
      const { defaultCanvasPluginMetadataRegistry } = await import('./canvas-metadata-db.ts');
      return defaultCanvasPluginMetadataRegistry();
    }
    const dir = tenantScopedPluginDir(options.dir ?? basePluginDir());
    if (!options.registry || hasTenantPluginScope()) return scanPlugins(dir);
    const toolsByPlugin = runtimeMcpTools(options);
    const plugins = options.registry().map((plugin) => ({
      ...plugin,
      enabled: readPluginEnabled(plugin.name) ?? plugin.enabled ?? true,
      mcpTools: toolsByPlugin ? (toolsByPlugin.get(plugin.name) ?? []) : plugin.mcpTools,
    }));
    return { plugins, count: plugins.length, dir };
  }, {
    detail: {
      tags: ['plugins'],
      menu: { group: 'main', order: 70 },
      summary: 'List loaded plugins',
    },
    query: t.Object({ kind: t.Optional(t.String()) }),
  });
}

export const pluginsRegistryRoute = createPluginsRegistryRoute();
