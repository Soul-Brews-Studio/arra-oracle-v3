import type { VectorDocument, VectorQueryResult } from './adapter.ts';

export const VECTOR_PROXY_PROTOCOL_VERSION = 'vector-proxy-v1';

export const VECTOR_PROXY_ROUTES = {
  add: '/vectors/add',
  query: '/vectors/query',
  stats: '/vectors/stats',
  export: '/vectors/export',
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

export interface VectorProxyExportResponse {
  ids: string[];
  embeddings: number[][];
  metadatas: any[];
  documents?: string[];
}

export type VectorProxyHealthStatus = 'ok' | 'degraded' | 'down';

export interface VectorProxyHealthResponse {
  status: VectorProxyHealthStatus;
  name: string;
  version: string;
  protocol?: typeof VECTOR_PROXY_PROTOCOL_VERSION | string;
}

export function buildVectorProxyUrl(endpoint: string, route: VectorProxyRoute | string): string {
  const safeBase = endpoint.trim().replace(/\/+$/, '');
  if (!safeBase) throw new Error('Vector proxy endpoint is required');
  return `${safeBase}${route.startsWith('/') ? route : `/${route}`}`;
}

export function isHealthyVectorProxy(health: Pick<VectorProxyHealthResponse, 'status'> | undefined): boolean {
  return health?.status === 'ok';
}
