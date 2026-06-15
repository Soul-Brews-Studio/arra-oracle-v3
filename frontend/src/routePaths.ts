export function mcpToolPath(name: string): string {
  return `/mcp/tools/${encodeURIComponent(name)}`;
}

export function menuSearchPath(query: string): string {
  const q = query.trim();
  if (!q) return '/search';
  return `/search?${new URLSearchParams({ q })}`;
}

export function vectorResultsPath(query: string): string {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('q', query.trim());
  return qs.toString() ? `/vector/results?${qs}` : '/vector/results';
}

export function vectorDocumentsPath(): string {
  return '/vector/documents';
}
