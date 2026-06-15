export function mcpToolPath(name: string): string {
  return `/mcp/tools/${encodeURIComponent(name)}`;
}

export function vectorResultsPath(query: string): string {
  const qs = new URLSearchParams();
  if (query.trim()) qs.set('q', query.trim());
  return qs.toString() ? `/vector/results?${qs}` : '/vector/results';
}
