export const TAURI_API_BASE = 'http://localhost:47778';
export const API_BASE = isTauri() ? TAURI_API_BASE : '';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

export type VectorProvider = {
  type: string;
  available: boolean;
  configured?: boolean;
  status?: string;
  models?: string[];
  capabilities?: string[];
  error?: string;
};

export type VectorProviderTestConfig = {
  provider: string;
  model?: string;
  url?: string;
  dimensions?: number;
  text?: string;
};

export type VectorProviderTestResult = {
  success: boolean;
  provider: string;
  dimensions?: number;
  model?: string;
  error?: string;
};

export type VectorService = {
  name: string;
  type: 'builtin' | 'proxy';
  endpoint?: string;
  capabilities?: Record<string, unknown>;
  health?: VectorHealthStatus;
};

export type VectorHealthStatus = {
  status: string;
  checkedAt?: string;
  success?: boolean;
  error?: string;
};

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function apiUrl(path: string): string {
  return API_BASE ? new URL(path, API_BASE).toString() : path;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const error = typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : response.statusText;
    throw new Error(`${path} returned ${response.status}: ${error}`);
  }
  return payload as T;
}

export async function getVectorProviders(): Promise<VectorProvider[]> {
  const body = await fetchJson<{ providers?: VectorProvider[] }>('/api/v1/vector/providers');
  return body.providers ?? [];
}

export function testVectorProvider(config: VectorProviderTestConfig): Promise<VectorProviderTestResult> {
  return fetchJson('/api/v1/vector/providers/test', { method: 'POST', body: JSON.stringify(config) });
}

export async function getVectorServices(): Promise<VectorService[]> {
  const body = await fetchJson<{ services?: VectorService[] }>('/api/v1/vector/services');
  return body.services ?? [];
}

export async function registerVectorService(service: VectorService): Promise<void> {
  await fetchJson('/api/v1/vector/services/register', { method: 'POST', body: JSON.stringify(service) });
}

export async function unregisterVectorService(name: string): Promise<void> {
  await fetchJson(`/api/v1/vector/services/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function testVectorService(name: string): Promise<VectorHealthStatus> {
  return fetchJson(`/api/v1/vector/services/${encodeURIComponent(name)}/test`, { method: 'POST' });
}
