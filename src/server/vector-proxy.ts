/**
 * VectorProxy — thin HTTP client for a remote vector service (#1071 phase 1.2).
 *
 * When VECTOR_URL is set, the vector route handlers and hybrid search route
 * their vector calls through this proxy instead of calling the local
 * vector adapter (LanceDB / Chroma).
 *
 * Design goals:
 *   - One method per remote endpoint we already expose (`/api/search`,
 *     `/api/similar`, `/api/compare`, `/api/map`, `/api/map3d`,
 *     `/api/vector/stats`, `/api/vector/health`).
 *   - Every method returns `T | null`. `null` always means "remote leg
 *     unavailable" — the caller decides whether to surface FTS5-only
 *     results or to error.
 *   - 15s timeout via AbortSignal.timeout (Ollama cold-start safe).
 *     Network errors, non-2xx, JSON parse failures, and timeouts all
 *     collapse to `null`. Health check uses a shorter 5s timeout.
 *   - Zero state. No retries, no in-process cache. Routing decisions
 *     live in the caller.
 *
 * Construction is gated by `createVectorProxy(url)` so callers can write:
 *   const proxy = createVectorProxy(VECTOR_URL);
 *   if (!proxy) { ...local adapter path... }
 */
import type { SearchResponse } from './types.ts';

const TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 5_000;

export interface VectorStatsResponse {
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{
    key: string;
    model: string;
    collection: string;
    count: number;
    enabled: boolean;
  }>;
}

export interface VectorHealthResponse {
  status: 'ok' | 'degraded' | 'down';
  engines: Array<{
    key: string;
    model: string;
    collection: string;
    ok: boolean;
    error?: string;
  }>;
  checked_at: string;
}

export interface SimilarResponse {
  results: SearchResponse['results'];
  docId: string;
}

export interface CompareResponse {
  query: string;
  models: string[];
  byModel: Record<string, unknown>;
  agreement: { top1: number; top5_jaccard: number; avg_rank_shift: number; shared_ids: string[] };
}

export interface MapResponse {
  documents: Array<{
    id: string; type: string; source_file: string; concepts: string[];
    chunk_ids: string[]; project: string | null; x: number; y: number;
    created_at: string | null;
  }>;
  total: number;
}

export interface Map3dResponse {
  documents: Array<{
    id: string; type: string; title: string; source_file: string;
    concepts: string[]; project: string | null;
    x: number; y: number; z: number; created_at: string | null;
  }>;
  total: number;
  pca_info: { variance_explained: number[]; n_vectors: number; n_dimensions: number; computed_at: string };
}

export interface VectorProxy {
  /** Hybrid search via remote — caller passes the same query params handleSearch accepts. */
  search(params: {
    q: string;
    type?: string;
    limit?: number;
    offset?: number;
    mode?: 'hybrid' | 'fts' | 'vector';
    project?: string;
    cwd?: string;
    model?: string;
  }): Promise<SearchResponse | null>;

  /** Nearest-neighbor by doc id. */
  similar(id: string, limit?: number, model?: string): Promise<SimilarResponse | null>;

  /** Fan-out search across multiple embedding models + agreement metrics. */
  compare(params: {
    q: string;
    models?: string;
    limit?: number;
    type?: string;
    project?: string;
    cwd?: string;
  }): Promise<CompareResponse | null>;

  /** 2D projection of all embeddings. */
  map(): Promise<MapResponse | null>;

  /** 3D PCA projection from real embeddings. */
  map3d(model?: string): Promise<Map3dResponse | null>;

  /** Per-engine collection counts. */
  stats(): Promise<VectorStatsResponse | null>;

  /** Liveness probe — true if `/api/vector/health` returns 200. */
  available(): Promise<boolean>;
}

/**
 * Build a VectorProxy bound to `baseUrl`, or return null if no URL was supplied.
 *
 * @param baseUrl — e.g. `https://vector.example.com` or empty/undefined for local mode
 */
export function createVectorProxy(baseUrl: string | undefined | null): VectorProxy | null {
  if (!baseUrl) return null;
  const base = baseUrl.replace(/\/+$/, '');

  async function fetchJson<T>(pathAndQuery: string, timeoutMs = TIMEOUT_MS): Promise<T | null> {
    const url = `${base}${pathAndQuery}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.warn(`[VectorProxy] ${pathAndQuery} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[VectorProxy] ${pathAndQuery} failed: ${msg}`);
      return null;
    }
  }

  function qs(params: Record<string, string | number | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join('&')}` : '';
  }

  return {
    async search(params) {
      return fetchJson<SearchResponse>(
        `/api/search${qs({
          q: params.q,
          type: params.type,
          limit: params.limit,
          offset: params.offset,
          mode: params.mode,
          project: params.project,
          cwd: params.cwd,
          model: params.model,
        })}`,
      );
    },

    async similar(id, limit, model) {
      return fetchJson<SimilarResponse>(`/api/similar${qs({ id, limit, model })}`);
    },

    async compare(params) {
      return fetchJson<CompareResponse>(
        `/api/compare${qs({
          q: params.q,
          models: params.models,
          limit: params.limit,
          type: params.type,
          project: params.project,
          cwd: params.cwd,
        })}`,
      );
    },

    async map() {
      return fetchJson<MapResponse>('/api/map');
    },

    async map3d(model) {
      return fetchJson<Map3dResponse>(`/api/map3d${qs({ model })}`);
    },

    async stats() {
      return fetchJson<VectorStatsResponse>('/api/vector/stats');
    },

    async available() {
      const result = await fetchJson<VectorHealthResponse>('/api/vector/health', HEALTH_TIMEOUT_MS);
      return result !== null && result.status !== 'down';
    },
  };
}
