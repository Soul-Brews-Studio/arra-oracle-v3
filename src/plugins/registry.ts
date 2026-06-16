import { statSync } from 'node:fs';
import { join } from 'node:path';

import {
  manifestSurfaces,
  publicUnifiedServerManifest,
  type UnifiedApiRouteManifest,
  type UnifiedCliSubcommandManifest,
  type UnifiedMcpToolManifest,
  type UnifiedMenuManifest,
  type UnifiedPluginSurface,
  type UnifiedProxyManifest,
} from './unified-manifest.ts';
import type { UnifiedExportFormatManifest } from './export-format-manifest.ts';
import type { LoadedUnifiedPlugin, UnifiedPluginStatus } from './unified-loader.ts';

type PublicApiRoute = Omit<UnifiedApiRouteManifest, 'handler'>;
type PublicMcpTool = Omit<UnifiedMcpToolManifest, 'handler'>;
type PublicCliSubcommand = Omit<UnifiedCliSubcommandManifest, 'handler'>;
type PublicExportFormat = Omit<UnifiedExportFormatManifest, 'handler'> & { extension: string };

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
  apiRoutes: PublicApiRoute[];
  proxy: UnifiedProxyManifest[];
  mcpTools: PublicMcpTool[];
  cliSubcommands: PublicCliSubcommand[];
  exportFormats: PublicExportFormat[];
  file: string;
  size: number;
  modified: string;
}

function manifestModified(plugin: LoadedUnifiedPlugin): string {
  return statSync(join(plugin.dir, 'plugin.json')).mtime.toISOString();
}

export function pluginRegistryFromLoadedPlugins(
  plugins: LoadedUnifiedPlugin[],
  statuses: UnifiedPluginStatus[],
): LoadedPluginRegistryEntry[] {
  const statusByName = new Map(statuses.map((status) => [status.name, status]));
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
      apiRoutes: plugin.manifest.apiRoutes.map(({ path, methods }) => ({ path, methods })),
      proxy: plugin.manifest.proxy.map(({ path, methods, targetEnv, stripPrefix }) => ({ path, methods, targetEnv, stripPrefix })),
      mcpTools: plugin.manifest.mcpTools.map(({ handler: _handler, ...tool }) => tool),
      cliSubcommands: plugin.manifest.cliSubcommands.map(({ handler: _handler, ...command }) => command),
      exportFormats: plugin.manifest.exportFormats.map(({ handler: _handler, name }) => ({ name, extension: name })),
      file: '',
      size: 0,
      modified: manifestModified(plugin),
    };
  });
}
