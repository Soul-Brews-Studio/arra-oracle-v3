import type { MenuItem, MenuResponse } from '../../../src/routes/menu/model';
import type {
  HealthResponse,
  MetricsSnapshot,
  PluginsResponse,
  RuntimeStatus,
  VectorSearchResponse,
} from '../../../src/server/types';
import type { LearnCreateResponse, LearnDeleteResponse, LearnListResponse, LearnMutationPayload, LearnUpdateResponse } from '../types';
import { API_BASE } from './oracle';

export interface MenuSearchResponse {
  data: MenuItem[];
  q: string;
  total: number;
}

export interface VectorIndexModelEntry {
  collection: string;
  model: string;
  adapter: string;
  count?: number;
}

export type VectorIndexCollection = VectorIndexModelEntry;

export interface VectorIndexModelsResponse {
  models: Record<string, VectorIndexModelEntry>;
}

export interface VectorHealthEngine {
  key?: string;
  model?: string;
  collection?: string;
  ok?: boolean;
  error?: string;
}

export interface VectorHealthResponse {
  status: RuntimeStatus;
  engines: VectorHealthEngine[];
  checked_at: string;
  proxy?: string;
  error?: string;
}

export type VectorIndexJobStatus = 'idle' | 'indexing' | 'completed' | 'error';

export interface VectorIndexStatusResponse {
  jobId: string;
  model: string;
  status: VectorIndexJobStatus;
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  docsPerSec: number;
  eta: number;
}

export interface VectorIndexStartResponse {
  jobId: string;
  status: 'started';
  model: string;
  batchSize: number;
}

export interface ApiRouteResponses {
  '/api/health': HealthResponse;
  '/api/v1/metrics': MetricsSnapshot;
  '/api/menu': MenuResponse;
  '/api/menu/search': MenuSearchResponse;
  '/api/v1/vector/search': VectorSearchResponse;
  '/api/vector/index/models': VectorIndexModelsResponse;
  '/api/vector/index/status': VectorIndexStatusResponse;
  '/api/vector/health': VectorHealthResponse;
  '/api/plugins': PluginsResponse;
  '/api/v1/learn': LearnListResponse;
}

export type ApiRoute = keyof ApiRouteResponses;
export type ApiResponse<Route extends ApiRoute> = ApiRouteResponses[Route];
export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: ApiFetch;
  headers?: HeadersInit;
}

export interface VectorSearchParams {
  q: string;
  limit?: number;
  offset?: number;
  type?: string;
  project?: string;
  cwd?: string;
  model?: string;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function backendMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.message === 'string') return payload.message;
  return fallback;
}

function urlFor(path: string, baseUrl = API_BASE): string {
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

function withJsonHeaders(base: HeadersInit | undefined, init: RequestInit): Headers {
  const headers = new Headers(base);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return headers;
}

function addParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions = {}) {}

  async request<Route extends ApiRoute>(route: Route, init: RequestInit = {}): Promise<ApiResponse<Route>> {
    return this.fetchJson(route, init);
  }

  health(): Promise<HealthResponse> {
    return this.request('/api/health');
  }

  metrics(): Promise<MetricsSnapshot> {
    return this.request('/api/v1/metrics');
  }

  menu(): Promise<MenuResponse> {
    return this.request('/api/menu');
  }

  menuSearch(q: string): Promise<MenuSearchResponse> {
    const query = new URLSearchParams({ q: q.trim() });
    return this.fetchJson(`/api/menu/search?${query.toString()}`);
  }

  plugins(): Promise<PluginsResponse> {
    return this.request('/api/plugins');
  }

  learn(): Promise<LearnListResponse> {
    return this.request('/api/v1/learn');
  }

  createLearn(payload: LearnMutationPayload): Promise<LearnCreateResponse> {
    return this.fetchJson('/api/v1/learn', { method: 'POST', body: JSON.stringify(payload) });
  }

  updateLearn(id: string, payload: LearnMutationPayload): Promise<LearnUpdateResponse> {
    return this.fetchJson(`/api/v1/learn/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  }

  deleteLearn(id: string): Promise<LearnDeleteResponse> {
    return this.fetchJson(`/api/v1/learn/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  vectorIndexModels(): Promise<VectorIndexModelsResponse> {
    return this.request('/api/vector/index/models');
  }

  vectorHealth(): Promise<VectorHealthResponse> {
    return this.request('/api/vector/health');
  }

  vectorSearch(query: string, limit?: number): Promise<VectorSearchResponse>;
  vectorSearch(params: VectorSearchParams): Promise<VectorSearchResponse>;
  vectorSearch(input: string | VectorSearchParams, limit?: number): Promise<VectorSearchResponse> {
    const params = typeof input === 'string' ? { q: input, limit } : input;
    const query = new URLSearchParams();
    addParam(query, 'q', params.q);
    addParam(query, 'limit', params.limit);
    addParam(query, 'offset', params.offset);
    addParam(query, 'type', params.type);
    addParam(query, 'project', params.project);
    addParam(query, 'cwd', params.cwd);
    addParam(query, 'model', params.model);
    return this.fetchJson(`/api/v1/vector/search?${query.toString()}`);
  }

  vectorIndexStatus(): Promise<VectorIndexStatusResponse> {
    return this.request('/api/vector/index/status');
  }

  startVectorIndex(model: string): Promise<VectorIndexStartResponse> {
    return this.fetchJson('/api/vector/index/start', { method: 'POST', body: JSON.stringify({ model }) });
  }

  private async fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const fetcher = this.options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetcher) throw new ApiClientError(0, path, `${path} is unreachable: fetch is unavailable`);

    const headers = withJsonHeaders(this.options.headers, init);
    let response: Response;
    try {
      response = await fetcher(urlFor(path, this.options.baseUrl), { ...init, headers });
    } catch (error) {
      throw new ApiClientError(0, path, `${path} is unreachable: ${messageFor(error)}`);
    }

    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiClientError(response.status, path, `${path} returned invalid JSON`);
    }

    if (!response.ok) {
      const detail = backendMessage(payload, response.statusText || 'request failed');
      throw new ApiClientError(response.status, path, `${path} returned ${response.status}: ${detail}`);
    }
    return payload as T;
  }
}

export const createApiClient = (options?: ApiClientOptions): ApiClient => new ApiClient(options);
export const apiClient = createApiClient();
