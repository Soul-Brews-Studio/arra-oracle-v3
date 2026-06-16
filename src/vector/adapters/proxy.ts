/**
 * Proxy Adapter — talks to a remote vector service that implements the
 * standard proxy protocol:
 *   - POST /vectors/add
 *   - POST /vectors/query
 *   - GET  /vectors/stats
 *   - DELETE /vectors/collection
 *   - GET  /health
 */

import type {
  VectorStoreAdapter,
  VectorDocument,
  VectorQueryResult,
} from '../types.ts';
import { currentTenantId, TENANT_HEADER } from '../../middleware/tenant.ts';

interface ProxyQueryRequest {
  text: string;
  limit?: number;
  where?: Record<string, any>;
}

interface ProxyStatsResponse {
  count: number;
  name: string;
}

interface ProxyHealthResponse {
  status: 'ok' | 'degraded' | 'down';
  name: string;
  version: string;
}

interface ProxyQueryResponse {
  ids: string[];
  documents: string[];
  distances: number[];
  metadatas: any[];
}

function tenantHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  const tenantId = currentTenantId();
  if (tenantId) headers[TENANT_HEADER] = tenantId;
  return headers;
}

function toQueryUrl(base: string, path: string): string {
  const safeBase = base.replace(/\/+$/, '');
  if (!path.startsWith('/')) return `${safeBase}/${path}`;
  return `${safeBase}${path}`;
}

export class ProxyVectorAdapter implements VectorStoreAdapter {
  readonly name: string = 'proxy';

  constructor(
    private readonly collectionName: string,
    private readonly endpoint: string,
    private readonly requestTimeoutMs = 15_000,
  ) {}

  async connect(): Promise<void> {
    const health = await this.health();
    if (!health || health.status !== 'ok') {
      throw new Error('Proxy vector service unavailable');
    }
  }

  async close(): Promise<void> {
    return undefined;
  }

  async ensureCollection(): Promise<void> {
    return undefined;
  }

  async deleteCollection(): Promise<void> {
    await this.del('/vectors/collection');
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    await this.post('/vectors/add', { documents: docs });
  }

  async query(text: string, limit: number = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    const body: ProxyQueryRequest = { text, limit, ...(where ? { where } : {}) };
    return this.postJson<ProxyQueryResponse>('/vectors/query', body);
  }

  async queryById(id: string, nResults: number = 5): Promise<VectorQueryResult> {
    return this.query('', nResults, { id });
  }

  async getStats(): Promise<{ count: number }> {
    const stats = await this.proxyStats();
    return { count: stats.count };
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    const stats = await this.proxyStats();
    return { name: stats.name || this.collectionName, count: stats.count };
  }

  async getAllEmbeddings(limit?: number): Promise<{
    ids: string[];
    embeddings: number[][];
    metadatas: any[];
    documents?: string[];
  }> {
    // Not part of proxy protocol. Return empty to preserve compatibility
    // when callers can proceed without full embedding matrices.
    return {
      ids: [],
      embeddings: [],
      metadatas: [],
      documents: [],
    };
  }

  private async proxyStats(): Promise<ProxyStatsResponse> {
    const stats = await this.fetchJson<ProxyStatsResponse>('/vectors/stats');
    return { count: stats?.count ?? 0, name: stats?.name || this.collectionName };
  }

  private async health(): Promise<ProxyHealthResponse> {
    const result = await this.fetchJson<ProxyHealthResponse>('/health', 5_000);
    if (!result) {
      return { status: 'down', name: this.collectionName, version: 'unknown' };
    }
    return result;
  }

  private async post(path: string, body: Record<string, any>): Promise<void> {
    const res = await fetch(toQueryUrl(this.endpoint, path), {
      method: 'POST',
      headers: tenantHeaders(true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    await this.assertResponse(res);
  }

  private async postJson<T>(path: string, body: Record<string, any>): Promise<T> {
    const res = await fetch(toQueryUrl(this.endpoint, path), {
      method: 'POST',
      headers: tenantHeaders(true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    await this.assertResponse(res);
    return (await res.json()) as T;
  }

  private async del(path: string): Promise<void> {
    const res = await fetch(toQueryUrl(this.endpoint, path), {
      method: 'DELETE',
      headers: tenantHeaders(),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    await this.assertResponse(res);
  }

  private async fetchJson<T>(path: string, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const res = await fetch(toQueryUrl(this.endpoint, path), {
      method: 'GET',
      headers: tenantHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await this.assertResponse(res);
    return (await res.json()) as T;
  }

  private async assertResponse(res: Response): Promise<void> {
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    throw new Error(`Proxy vector request failed: ${res.status} ${res.statusText} ${body}`);
  }
}
