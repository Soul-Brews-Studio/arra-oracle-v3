import { statSync } from 'node:fs';
import { join } from 'node:path';

import {
  manifestSurfaces,
  publicUnifiedServerManifest,
  type UnifiedMenuManifest,
  type UnifiedPluginSurface,
} from './unified-manifest.ts';
import type { LoadedUnifiedPlugin, UnifiedPluginStatus } from './unified-loader.ts';

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
      file: '',
      size: 0,
      modified: manifestModified(plugin),
    };
  });
}
