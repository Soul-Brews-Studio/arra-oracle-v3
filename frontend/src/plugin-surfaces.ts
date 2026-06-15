import type { PluginEntry } from './types';

export type Surface = 'wasm' | 'menu' | 'server' | 'mcp';

export function surfacesFor(plugin: PluginEntry): Surface[] {
  const surfaces: Surface[] = [];
  if (plugin.file) surfaces.push('wasm');
  if (plugin.menu) surfaces.push('menu');
  if (plugin.server) surfaces.push('server');
  if (plugin.mcpTools?.length) surfaces.push('mcp');
  return surfaces;
}

export function countPluginSurfaces(plugins: PluginEntry[]): number {
  return plugins.reduce((total, plugin) => total + Math.max(1, surfacesFor(plugin).length), 0);
}
