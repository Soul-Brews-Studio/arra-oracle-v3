import { VECTOR_PROXY_PROTOCOL_VERSION, VECTOR_PROXY_ROUTES, buildVectorProxyUrl } from './proxy-protocol.ts';
export { VECTOR_PROXY_PROTOCOL_VERSION } from './proxy-protocol.ts';
import type { VectorDBType } from './types.ts';

export const VECTOR_PROXY_ENV_KEYS = ['ORACLE_PROXY_VECTOR_URL', 'VECTOR_DB_URL'] as const;
export const VECTOR_PROXY_TIMEOUT_ENV = 'ORACLE_PROXY_VECTOR_TIMEOUT_MS';
export const VECTOR_PROXY_DEFAULT_TIMEOUT_MS = 15_000;
export const VECTOR_PROXY_HEALTH_TIMEOUT_MS = 5_000;
export const VECTOR_PROXY_LOCAL_BACKENDS = ['lancedb', 'qdrant', 'turbovec'] as const;

export type VectorProxyEnvKey = typeof VECTOR_PROXY_ENV_KEYS[number];
export type VectorProxyLocalBackend = typeof VECTOR_PROXY_LOCAL_BACKENDS[number];

export interface VectorProxyContract {
  protocol: typeof VECTOR_PROXY_PROTOCOL_VERSION;
  baseUrl: string;
  routes: typeof VECTOR_PROXY_ROUTES;
  backend?: VectorProxyLocalBackend;
  collectionName?: string;
  timeoutMs: number;
  healthTimeoutMs: number;
}

export interface VectorProxyConfigInput {
  endpoint?: string;
  env?: Record<string, string | undefined>;
  collectionName?: string;
  backend?: VectorDBType | string;
  timeoutMs?: number;
}

export function resolveVectorProxyContract(input: VectorProxyConfigInput = {}): VectorProxyContract | null {
  const env = input.env ?? process.env;
  const endpoint = normalizeHttpUrl(input.endpoint ?? firstEnv(env, VECTOR_PROXY_ENV_KEYS));
  if (!endpoint) return null;
  return {
    protocol: VECTOR_PROXY_PROTOCOL_VERSION,
    baseUrl: endpoint,
    routes: VECTOR_PROXY_ROUTES,
    backend: normalizeLocalBackend(input.backend),
    collectionName: clean(input.collectionName),
    timeoutMs: positiveInt(input.timeoutMs ?? numberEnv(env[VECTOR_PROXY_TIMEOUT_ENV]), VECTOR_PROXY_DEFAULT_TIMEOUT_MS),
    healthTimeoutMs: VECTOR_PROXY_HEALTH_TIMEOUT_MS,
  };
}

export function vectorProxyRouteUrls(contract: Pick<VectorProxyContract, 'baseUrl'>): Record<keyof typeof VECTOR_PROXY_ROUTES, string> {
  return Object.fromEntries(
    Object.entries(VECTOR_PROXY_ROUTES).map(([name, route]) => [name, buildVectorProxyUrl(contract.baseUrl, route)]),
  ) as Record<keyof typeof VECTOR_PROXY_ROUTES, string>;
}

export function requireVectorProxyContract(input: VectorProxyConfigInput = {}): VectorProxyContract {
  const contract = resolveVectorProxyContract(input);
  if (!contract) throw new Error('Vector proxy endpoint requires ORACLE_PROXY_VECTOR_URL or VECTOR_DB_URL');
  return contract;
}

function firstEnv(env: Record<string, string | undefined>, keys: readonly VectorProxyEnvKey[]): string | undefined {
  for (const key of keys) {
    const value = clean(env[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function normalizeLocalBackend(value: string | undefined): VectorProxyLocalBackend | undefined {
  const backend = clean(value)?.toLowerCase();
  return VECTOR_PROXY_LOCAL_BACKENDS.includes(backend as VectorProxyLocalBackend)
    ? backend as VectorProxyLocalBackend
    : undefined;
}

function numberEnv(value: string | undefined): number | undefined {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
