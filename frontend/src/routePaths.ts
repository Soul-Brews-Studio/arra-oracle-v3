export function mcpToolPath(name: string): string {
  return `/mcp/tools/${encodeURIComponent(name)}`;
}

export function mcpToolsPath(filters: { q?: string; source?: string } = {}): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.source && filters.source !== 'all') params.set('source', filters.source);
  const query = params.toString();
  return query ? `/mcp?${query}` : '/mcp';
}

export function menuSearchPath(query: string): string {
  const q = query.trim();
  if (!q) return '/search';
  return `/search?${new URLSearchParams({ q })}`;
}

export function pluginInventoryPath(filters: { q?: string; surface?: string; visibility?: string } = {}): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.surface && filters.surface !== 'all') params.set('surface', filters.surface);
  if (filters.visibility && filters.visibility !== 'all') params.set('visibility', filters.visibility);
  const query = params.toString();
  return query ? `/plugins?${query}` : '/plugins';
}

export function menuCatalogPath(filters: { group?: string; source?: string } = {}): string {
  const params = new URLSearchParams();
  if (filters.group && filters.group !== 'all') params.set('group', filters.group);
  if (filters.source && filters.source !== 'all') params.set('source', filters.source);
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

export function vectorDocumentsPath(): string {
  return '/vector/documents';
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

export function canvasPluginsPath(): string {
  return '/canvas/plugins';
}

export function storagePath(): string {
  return '/storage';
}
