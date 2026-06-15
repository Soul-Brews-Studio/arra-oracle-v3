import type { McpToolsResponse, MenuResponse, PluginsResponse, SearchResponse } from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) throw new ApiError(response.status, `${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchMenu(): Promise<MenuResponse> {
  const data = await getJson<MenuResponse>('/api/menu');
  return { items: Array.isArray(data.items) ? data.items : [] };
}

export async function fetchPlugins(): Promise<PluginsResponse> {
  const data = await getJson<PluginsResponse>('/api/plugins');
  return {
    dir: typeof data.dir === 'string' ? data.dir : '',
    plugins: Array.isArray(data.plugins) ? data.plugins : [],
  };
}

export async function searchVector(query: string, limit = 8): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query, mode: 'vector', limit: String(limit) });
  const data = await getJson<SearchResponse>(`/api/search?${qs}`);
  return {
    results: Array.isArray(data.results) ? data.results : [],
    total: Number.isFinite(data.total) ? data.total : 0,
    query: typeof data.query === 'string' ? data.query : query,
    limit: data.limit,
    offset: data.offset,
    error: data.error,
  };
}

export async function fetchMcpTools(): Promise<McpToolsResponse> {
  const data = await getJson<McpToolsResponse>('/api/mcp/tools');
  return {
    tools: Array.isArray(data.tools) ? data.tools : [],
    total: Number.isFinite(data.total) ? data.total : 0,
  };
}
