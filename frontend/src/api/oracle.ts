export const TAURI_API_BASE = 'http://localhost:47778';
export const DEFAULT_ORACLE_HOST = 'localhost:47778';
export const ORACLE_HOST_STORAGE_KEY = 'oracle.host';

export type PrivateNetworkRequestInit = RequestInit & { targetAddressSpace?: 'local' };

type LocationLike = Pick<Location, 'protocol' | 'search' | 'pathname' | 'hash'>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type HistoryLike = Pick<History, 'replaceState'>;

export interface OracleApiBaseEnvironment {
  history?: HistoryLike;
  isTauri?: boolean;
  location?: LocationLike;
  localStorage?: StorageLike;
}

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

function browserStorage(): StorageLike | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function browserEnv(): OracleApiBaseEnvironment {
  if (typeof window === 'undefined') return {};
  return { history: window.history, isTauri: isTauri(), location: window.location, localStorage: browserStorage() };
}

function storageGet(storage: StorageLike | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(storage: StorageLike | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Ignore storage failures in private/locked-down browser contexts.
  }
}

function cleanHostQuery(env: OracleApiBaseEnvironment): void {
  if (!env.location?.search?.includes('host=')) return;
  try {
    const params = new URLSearchParams(env.location.search);
    params.delete('host');
    const query = params.toString();
    env.history?.replaceState(null, '', `${env.location.pathname}${query ? `?${query}` : ''}${env.location.hash}`);
  } catch {
    // Keep the original URL if history or URLSearchParams are unavailable.
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export function normalizeOracleHost(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).host;
    } catch {
      return trimmed.replace(/^https?:\/\//i, '').replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
    }
  }
  return trimmed.replace(/^\/+/, '').split('/')[0]?.trim() ?? '';
}

export function oracleApiBaseForHost(host = DEFAULT_ORACLE_HOST): string {
  return `http://${normalizeOracleHost(host) || DEFAULT_ORACLE_HOST}`;
}

export function resolveOracleApiBase(env: OracleApiBaseEnvironment = browserEnv()): string {
  if (env.isTauri ?? isTauri()) return TAURI_API_BASE;
  if (!env.location) return '';

  const queryHost = normalizeOracleHost(new URLSearchParams(env.location.search).get('host'));
  if (queryHost) {
    storageSet(env.localStorage, ORACLE_HOST_STORAGE_KEY, queryHost);
    cleanHostQuery(env);
    return oracleApiBaseForHost(queryHost);
  }

  const storedHost = normalizeOracleHost(storageGet(env.localStorage, ORACLE_HOST_STORAGE_KEY));
  if (storedHost) return oracleApiBaseForHost(storedHost);
  return env.location.protocol === 'https:' ? oracleApiBaseForHost(DEFAULT_ORACLE_HOST) : '';
}

export const API_BASE = resolveOracleApiBase();

export function apiUrl(path: string): string {
  return API_BASE ? new URL(path, API_BASE).toString() : path;
}

export function withOracleFetchInit(init: RequestInit = {}, baseUrl = API_BASE): PrivateNetworkRequestInit {
  if (!baseUrl.startsWith('http://')) return init;
  return { ...init, targetAddressSpace: 'local' };
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

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), withOracleFetchInit({
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  }));
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
