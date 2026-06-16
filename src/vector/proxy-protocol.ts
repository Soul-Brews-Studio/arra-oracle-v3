import type { VectorDocument, VectorQueryResult } from './types.ts';

export const VECTOR_PROXY_PROTOCOL_VERSION = 'vector-proxy-v1';

export const VECTOR_PROXY_ROUTES = {
  add: '/vectors/add',
  query: '/vectors/query',
  stats: '/vectors/stats',
  collection: '/vectors/collection',
  health: '/health',
} as const;

export type VectorProxyRoute = typeof VECTOR_PROXY_ROUTES[keyof typeof VECTOR_PROXY_ROUTES];

export interface VectorProxyAddRequest {
  documents: VectorDocument[];
}

export interface VectorProxyQueryRequest {
  text: string;
  limit?: number;
  where?: Record<string, unknown>;
}

export type VectorProxyQueryResponse = VectorQueryResult;

export interface VectorProxyStatsResponse {
  count: number;
  name: string;
}

export type VectorProxyHealthStatus = 'ok' | 'degraded' | 'down';

export interface VectorProxyHealthResponse {
  status: VectorProxyHealthStatus;
  name: string;
  version: string;
  protocol?: typeof VECTOR_PROXY_PROTOCOL_VERSION | string;
}

export function buildVectorProxyUrl(endpoint: string, route: VectorProxyRoute | string): string {
  const safeBase = endpoint.replace(/\/+$/, '');
  return `${safeBase}${route.startsWith('/') ? route : `/${route}`}`;
}

export function isHealthyVectorProxy(health: Pick<VectorProxyHealthResponse, 'status'> | undefined): boolean {
  return health?.status === 'ok';
}
