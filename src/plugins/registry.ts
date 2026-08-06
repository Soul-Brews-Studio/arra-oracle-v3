import { statSync } from 'node:fs';
import { join } from 'node:path';

import {
  manifestSurfaces,
  publicUnifiedServerManifest,
  type UnifiedMenuManifest,
  type UnifiedPluginSurface,
} from './unified-manifest.ts';
import type { LoadedUnifiedPlugin, UnifiedPluginStatus } from './unified-loader.ts';

type PluginManifest = LoadedUnifiedPlugin['manifest'];
export type RegisteredMcpTool = PluginManifest['mcpTools'][number] & { plugin?: string };
export type PublicMcpTool = Omit<PluginManifest['mcpTools'][number], 'handler'> & { source: 'plugin'; plugin: string };
type PublicApiRoute = Omit<PluginManifest['apiRoutes'][number], 'handler'>;
type PublicCliSubcommand = Omit<PluginManifest['cliSubcommands'][number], 'handler'>;
type PublicExportFormat = { name: string; extension: string };

export interface LoadedPluginRegistryEntry {
  name: string;
  version: string;
  status: UnifiedPluginStatus['status'];
  surfaces: UnifiedPluginSurface[];
  error?: string;
  enabled?: boolean;
  description?: string;
  menu?: UnifiedMenuManifest;
  server?: ReturnType<typeof publicUnifiedServerManifest>;
  mcpTools: PublicMcpTool[];
  apiRoutes: PublicApiRoute[];
  proxy: PluginManifest['proxy'];
  cliSubcommands: PublicCliSubcommand[];
  exportFormats: PublicExportFormat[];
  file: string;
  size: number;
  modified: string;
}

function manifestModified(plugin: LoadedUnifiedPlugin): string {
  return statSync(join(plugin.dir, 'plugin.json')).mtime.toISOString();
}

function publicMcpTools(manifest: PluginManifest): PublicMcpTool[] {
  return manifest.mcpTools
    .filter((tool) => tool.enabled !== false)
    .map(({ handler, ...tool }) => ({ ...tool, source: 'plugin', plugin: manifest.name }));
}

export function publicMcpToolsByPlugin(tools: RegisteredMcpTool[]): Map<string, PublicMcpTool[]> {
  const byPlugin = new Map<string, PublicMcpTool[]>();
  for (const { handler, plugin, ...tool } of tools) {
    if (!plugin || tool.enabled === false) continue;
    const current = byPlugin.get(plugin) ?? [];
    current.push({ ...tool, source: 'plugin', plugin });
    byPlugin.set(plugin, current);
  }
  return byPlugin;
}

function publicApiRoutes(manifest: PluginManifest): PublicApiRoute[] {
  return manifest.apiRoutes.map(({ handler, ...route }) => route);
}

function publicCliSubcommands(manifest: PluginManifest): PublicCliSubcommand[] {
  return manifest.cliSubcommands.map(({ handler, ...command }) => command);
}

function publicExportFormats(manifest: PluginManifest): PublicExportFormat[] {
  return manifest.exportFormats.map((format) => ({ name: format.name, extension: format.name }));
}

export function pluginRegistryFromLoadedPlugins(
  plugins: LoadedUnifiedPlugin[],
  statuses: UnifiedPluginStatus[],
  registeredMcpTools?: RegisteredMcpTool[],
): LoadedPluginRegistryEntry[] {
  const statusByName = new Map(statuses.map((status) => [status.name, status]));
  const runtimeMcpTools = registeredMcpTools ? publicMcpToolsByPlugin(registeredMcpTools) : null;
  return plugins.map((plugin) => {
    const status = statusByName.get(plugin.manifest.name);
    return {
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      status: status?.status ?? 'ok',
      error: status?.error,
      enabled: plugin.manifest.enabled !== false,
      surfaces: manifestSurfaces(plugin.manifest),
      description: plugin.manifest.description,
      menu: plugin.manifest.menu[0],
      server: publicUnifiedServerManifest(plugin.manifest.server),
      mcpTools: runtimeMcpTools ? (runtimeMcpTools.get(plugin.manifest.name) ?? []) : publicMcpTools(plugin.manifest),
      apiRoutes: publicApiRoutes(plugin.manifest),
      proxy: plugin.manifest.proxy,
      cliSubcommands: publicCliSubcommands(plugin.manifest),
      exportFormats: publicExportFormats(plugin.manifest),
      file: '',
      size: 0,
      modified: manifestModified(plugin),
    };
  });
}
