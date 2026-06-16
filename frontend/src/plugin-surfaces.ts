import type { PluginEntry } from './types';

export type Surface =
  | 'wasm'
  | 'menu'
  | 'server'
  | 'mcp'
  | 'apiRoutes'
  | 'proxy'
  | 'cliSubcommands'
  | 'exportFormats';

function add(surfaceSet: Set<Surface>, surface: unknown): void {
  if (surface === 'mcpTools') {
    surfaceSet.add('mcp');
    return;
  }
  if (surface === 'wasm' || surface === 'menu' || surface === 'server' || surface === 'mcp' || surface === 'apiRoutes' || surface === 'proxy' || surface === 'cliSubcommands' || surface === 'exportFormats') {
    surfaceSet.add(surface);
  }
}

export function surfacesFor(plugin: PluginEntry): Surface[] {
  const surfaceSet = new Set<Surface>();
  plugin.surfaces?.forEach((surface) => add(surfaceSet, surface));
  if (plugin.file) surfaceSet.add('wasm');
  if (plugin.menu) surfaceSet.add('menu');
  if (plugin.server) surfaceSet.add('server');
  if (plugin.mcpTools?.length) surfaceSet.add('mcp');
  if (plugin.apiRoutes?.length) surfaceSet.add('apiRoutes');
  if (plugin.proxy?.length) surfaceSet.add('proxy');
  if (plugin.cliSubcommands?.length) surfaceSet.add('cliSubcommands');
  if (plugin.exportFormats?.length) surfaceSet.add('exportFormats');
  return [...surfaceSet];
}

export function countPluginSurfaces(plugins: PluginEntry[]): number {
  return plugins.reduce((total, plugin) => total + Math.max(1, surfacesFor(plugin).length), 0);
}
