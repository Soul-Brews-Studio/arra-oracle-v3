export function mcpToolPath(name: string): string {
  return `/mcp/tools/${encodeURIComponent(name)}`;
}

export function menuSearchPath(query: string): string {
  const q = query.trim();
  if (!q) return '/search';
  return `/search?${new URLSearchParams({ q })}`;
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
