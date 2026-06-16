import { apiUrl } from './api/oracle';
import type { McpToolsResponse, MenuResponse, PluginsResponse, SearchResponse, SettingsSystemResponse, VectorConfigResponse, VectorConfigUpdateResponse } from './types';

export { API_BASE, apiUrl, isTauri } from './api/oracle';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `${path} is unreachable: ${message}`);
  }
  const payload = await response.text();
  let data: unknown = {};
  try {
    data = payload ? JSON.parse(payload) : {};
  } catch {
    throw new ApiError(response.status, `${path} returned invalid JSON`);
  }
  if (!response.ok) {
    const errorValue = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    const detail = typeof errorValue === 'string' ? errorValue : response.statusText;
    throw new ApiError(response.status, `${path} returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return data as T;
}

export async function fetchMenu(): Promise<MenuResponse> {
  const data = await getJson<MenuResponse>('/api/menu');
  return { items: Array.isArray(data.items) ? data.items : [] };
}

export async function fetchPlugins(): Promise<PluginsResponse> {
  const data = await getJson<PluginsResponse>('/api/v1/plugins');
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

export async function fetchSettingsSystem(): Promise<SettingsSystemResponse> {
  return getJson<SettingsSystemResponse>('/api/settings/system');
}

export async function fetchVectorConfig(): Promise<VectorConfigResponse> {
  return getJson<VectorConfigResponse>('/api/v1/vector/config');
}

export async function updateVectorCollection(collection: string, patch: { adapter?: string; enabled?: boolean; provider?: string }): Promise<VectorConfigUpdateResponse> {
  return getJson<VectorConfigUpdateResponse>(`/api/v1/vector/config/${encodeURIComponent(collection)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function reloadVectorConfig(): Promise<VectorConfigUpdateResponse> {
  return getJson<VectorConfigUpdateResponse>('/api/v1/vector/config/reload', { method: 'POST' });
}
