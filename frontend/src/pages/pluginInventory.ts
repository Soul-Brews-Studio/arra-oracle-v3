import { surfacesFor, type Surface } from '../plugin-surfaces';
import { isPluginEnabled, type PluginEnabledState } from '../components/PluginList';
import type { PluginEntry } from '../types';

export type Tone = 'ok' | 'warn' | 'bad' | 'idle';
export type PluginVisibilityFilter = 'all' | 'enabled' | 'disabled' | 'unhealthy';
export type PluginSurfaceFilter = 'all' | Surface | 'metadata';
export type PluginFilterDefaults = {
  query: string;
  visibility: PluginVisibilityFilter;
  surface: PluginSurfaceFilter;
};

const visibilityValues: PluginVisibilityFilter[] = ['all', 'enabled', 'disabled', 'unhealthy'];
const surfaceValues: PluginSurfaceFilter[] = ['all', 'wasm', 'menu', 'server', 'mcp', 'apiRoutes', 'proxy', 'cliSubcommands', 'exportFormats', 'metadata'];

function isVisibility(value: string | null): value is PluginVisibilityFilter {
  return visibilityValues.includes(value as PluginVisibilityFilter);
}

function isSurface(value: string | null): value is PluginSurfaceFilter {
  return surfaceValues.includes(value as PluginSurfaceFilter);
}

export function pluginFiltersFromSearch(search = ''): PluginFilterDefaults {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const visibility = params.get('visibility');
  const surface = params.get('surface');
  return {
    query: params.get('q') ?? params.get('query') ?? '',
    visibility: isVisibility(visibility) ? visibility : 'all',
    surface: isSurface(surface) ? surface : 'all',
  };
}

export function enabledStateForPlugins(plugins: PluginEntry[]): PluginEnabledState {
  return Object.fromEntries(plugins.map((plugin) => [
    plugin.name,
    plugin.enabled ?? plugin.status !== 'disabled',
  ]));
}

export function pluginAdminSummary(plugins: PluginEntry[], enabledState: PluginEnabledState): string {
  const enabled = plugins.filter((plugin) => isPluginEnabled(plugin, enabledState)).length;
  const disabled = plugins.length - enabled;
  return `${enabled} enabled · ${disabled} disabled · ${plugins.length} registered`;
}

export function healthForPlugin(plugin: PluginEntry, enabled: boolean): { label: string; detail: string; tone: Tone } {
  if (!enabled) return { label: 'inactive', detail: 'disabled in plugin state', tone: 'idle' };
  if (plugin.error) return { label: 'unhealthy', detail: plugin.error, tone: 'bad' };
  if (plugin.status === 'degraded') return { label: 'degraded', detail: 'reported by plugin manifest', tone: 'warn' };
  if (plugin.status && plugin.status !== 'ok') {
    return { label: plugin.status, detail: plugin.server?.healthPath ?? 'reported by plugin manifest', tone: 'warn' };
  }
  return { label: 'healthy', detail: plugin.server?.healthPath ?? 'manifest ok', tone: 'ok' };
}

export function pluginSurfaceFilterOptions(plugins: PluginEntry[]): PluginSurfaceFilter[] {
  const options = new Set<PluginSurfaceFilter>();
  for (const plugin of plugins) {
    const surfaces = surfacesFor(plugin);
    if (surfaces.length) surfaces.forEach((surface) => options.add(surface));
    else options.add('metadata');
  }
  return [...options].sort();
}

function queryText(plugin: PluginEntry): string {
  return [
    plugin.name,
    plugin.description,
    plugin.status,
    plugin.error,
    plugin.version,
    plugin.file,
    plugin.server?.command,
    plugin.server?.healthPath,
    plugin.menu?.label,
    ...surfacesFor(plugin),
    ...arrayOf(plugin.mcpTools).map((tool) => tool.name),
    ...arrayOf(plugin.apiRoutes).map((route) => route.path),
    ...arrayOf(plugin.proxy).map((proxy) => proxy.path),
    ...arrayOf(plugin.cliSubcommands).map((command) => command.command),
    ...arrayOf(plugin.exportFormats).map((format) => format.extension),
  ].filter(Boolean).join(' ').toLowerCase();
}

function arrayOf<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function pluginMatchesVisibility(plugin: PluginEntry, enabledState: PluginEnabledState, filter: PluginVisibilityFilter): boolean {
  const enabled = isPluginEnabled(plugin, enabledState);
  const health = healthForPlugin(plugin, enabled).tone;
  if (filter === 'enabled') return enabled;
  if (filter === 'disabled') return !enabled;
  if (filter === 'unhealthy') return health === 'bad' || health === 'warn';
  return true;
}

function pluginMatchesSurface(plugin: PluginEntry, filter: PluginSurfaceFilter): boolean {
  if (filter === 'all') return true;
  const surfaces = surfacesFor(plugin);
  return surfaces.length ? surfaces.includes(filter as Surface) : filter === 'metadata';
}

export function filteredPluginsFor(
  plugins: PluginEntry[],
  enabledState: PluginEnabledState,
  query: string,
  visibility: PluginVisibilityFilter,
  surface: PluginSurfaceFilter = 'all',
): PluginEntry[] {
  const needle = query.trim().toLowerCase();
  return plugins.filter((plugin) => {
    const queryMatch = !needle || queryText(plugin).includes(needle);
    return queryMatch && pluginMatchesVisibility(plugin, enabledState, visibility) && pluginMatchesSurface(plugin, surface);
  });
}
