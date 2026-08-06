import { CANVAS_ORIGIN, DEFAULT_CANVAS_PLUGIN, canvasPluginPath } from '@soul-brews/canvas-plugins';

export function mcpToolPath(name: string): string {
  return `/mcp/tools/${encodeURIComponent(name)}`;
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? '';
}

function scopedFilter(value: string | undefined): string {
  const normalized = trimmed(value);
  return normalized && normalized !== 'all' ? normalized : '';
}

export function mcpToolsPath(filters: { q?: string; source?: string } = {}): string {
  const params = new URLSearchParams();
  const q = trimmed(filters.q);
  const source = scopedFilter(filters.source);
  if (q) params.set('q', q);
  if (source) params.set('source', source);
  const query = params.toString();
  return query ? `/mcp?${query}` : '/mcp';
}

export function menuSearchPath(query: string): string {
  const q = query.trim();
  if (!q) return '/search';
  return `/search?${new URLSearchParams({ q })}`;
}

export function askPath(question = ''): string {
  const q = question.trim();
  if (!q) return '/ask';
  return `/ask?${new URLSearchParams({ q })}`;
}

export function pluginInventoryPath(filters: { q?: string; surface?: string; visibility?: string } = {}): string {
  const params = new URLSearchParams();
  const q = trimmed(filters.q);
  const surface = scopedFilter(filters.surface);
  const visibility = scopedFilter(filters.visibility);
  if (q) params.set('q', q);
  if (surface) params.set('surface', surface);
  if (visibility) params.set('visibility', visibility);
  const query = params.toString();
  return query ? `/plugins?${query}` : '/plugins';
}

export function menuCatalogPath(filters: { group?: string; source?: string } = {}): string {
  const params = new URLSearchParams();
  const group = scopedFilter(filters.group);
  const source = scopedFilter(filters.source);
  if (group) params.set('group', group);
  if (source) params.set('source', source);
  const query = params.toString();
  return query ? `/menu?${query}` : '/menu';
}

export function vectorDashboardPath(): string {
  return '/vector';
}

export function vectorSearchPath(query = ''): string {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('q', query.trim());
  return qs.toString() ? `/vector/search?${qs}` : '/vector/search';
}

export function vectorResultsPath(query: string): string {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('q', query.trim());
  return qs.toString() ? `/vector/results?${qs}` : '/vector/results';
}

export function exportPagePath(): string {
  return '/export';
}

export function memoryPath(query = ''): string {
  const q = query.trim();
  if (!q) return '/memory';
  return `/memory?${new URLSearchParams({ q })}`;
}

export function memoryConsolidationPath(): string {
  return '/memory/consolidation';
}

export function vectorDocumentsPath(): string {
  return '/vector/documents';
}

export function vectorFirstRunPath(): string {
  return '/vector/first-run';
}

export function vectorIndexPath(): string {
  return '/vector/index';
}

export function vectorExportPagePath(): string {
  return '/vector/export';
}

export function vectorSettingsPath(): string {
  return '/vector/settings';
}

export function canvasAppPath(plugin = 'wave'): string {
  const id = plugin.trim();
  return id ? `/canvas?${new URLSearchParams({ plugin: id })}` : '/canvas';
}

export function canvasStandalonePath(plugin = DEFAULT_CANVAS_PLUGIN): string {
  return canvasPluginPath(plugin);
}

export function canvasStandaloneUrl(plugin = DEFAULT_CANVAS_PLUGIN, origin = CANVAS_ORIGIN): string {
  return new URL(canvasStandalonePath(plugin), origin).toString();
}

export function canvasPluginsPath(): string {
  return '/canvas/plugins';
}

export function storagePath(): string {
  return '/storage';
}
