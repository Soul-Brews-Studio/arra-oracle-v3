import { apiUrl } from '../api/oracle';

export const ADAPTER_OPTIONS = ['chroma', 'sqlite-vec', 'lancedb', 'qdrant', 'cloudflare-vectorize', 'proxy', 'turbovec'] as const;
export type VectorConfigAdapter = (typeof ADAPTER_OPTIONS)[number];

export type LoadState = 'loading' | 'ready' | 'error';

export type VectorServerCollection = {
  collection: string;
  model: string;
  provider: string;
  adapter?: VectorConfigAdapter;
  primary?: boolean;
  enabled?: boolean;
};

export type VectorServerConfig = {
  version: string;
  host: string;
  port: number;
  dataPath: string;
  collections: Record<string, VectorServerCollection>;
  embeddingEndpoint: string;
  embedder?: {
    backend: string;
  };
};

export type VectorConfigHealth = {
  ok: boolean;
  status: 'ok' | 'down';
  collection: string;
  adapter: VectorConfigAdapter;
  model: string;
  error?: string;
};

export type VectorConfigResponse = {
  source: 'file' | 'defaults';
  engine: VectorConfigAdapter;
  enabled: boolean;
  options: { localEngines: VectorConfigAdapter[] };
  config: VectorServerConfig;
  doc_counts: Record<string, number>;
  health: Record<string, VectorConfigHealth>;
  checked_at: string;
};

export interface VectorConfigDraft {
  model: string;
  provider: string;
  adapter: VectorConfigAdapter;
  enabled: boolean;
}

export type VectorConfigRow = {
  key: string;
  collection: string;
  model: string;
  provider: string;
  adapter: VectorConfigAdapter;
  primary?: boolean;
  enabled: boolean;
  count?: number;
  health?: VectorConfigHealth;
};

export interface VectorCollectionTest {
  success: boolean;
  status?: string;
  count?: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAdapter(value: unknown): value is VectorConfigAdapter {
  return typeof value === 'string' && (ADAPTER_OPTIONS as readonly string[]).includes(value);
}

export function safeAdapter(value: unknown): VectorConfigAdapter {
  return isAdapter(value) ? value : 'lancedb';
}

export function parseVectorConfigResponse(value: unknown): VectorConfigResponse {
  const fallback = {
    source: 'defaults' as const,
    config: {
      version: 'unknown',
      host: 'unknown',
      port: 0,
      dataPath: 'unknown',
      collections: {},
      embeddingEndpoint: '',
      embedder: { backend: 'unknown' },
    },
    engine: 'lancedb' as VectorConfigAdapter,
    enabled: false,
    options: { localEngines: ['lancedb', 'qdrant', 'sqlite-vec'] as VectorConfigAdapter[] },
    doc_counts: {},
    health: {},
    checked_at: new Date().toISOString(),
  };

  if (!isRecord(value)) return fallback;
  const configValue = isRecord(value.config) ? value.config : {};
  const rawCollections = isRecord(configValue.collections) ? configValue.collections : {};
  const rawOptions = isRecord(value.options) ? value.options : {};
  const localEngines = Array.isArray(rawOptions.localEngines)
    ? rawOptions.localEngines.filter(isAdapter)
    : fallback.options.localEngines;
  const safeCollections: Record<string, VectorServerCollection> = {};

  Object.entries(rawCollections).forEach(([key, item]) => {
    if (!isRecord(item)) return;
    const collection = typeof item.collection === 'string' ? item.collection : key;
    safeCollections[key] = {
      collection,
      model: typeof item.model === 'string' ? item.model : key,
      provider: typeof item.provider === 'string' ? item.provider : 'none',
      adapter: safeAdapter(item.adapter),
      primary: item.primary === true,
      enabled: item.enabled !== false,
    };
  });

  return {
    source: value.source === 'file' ? 'file' : 'defaults',
    engine: safeAdapter(value.engine),
    enabled: value.enabled === true,
    options: { localEngines },
    config: {
      version: typeof configValue.version === 'string' ? configValue.version : fallback.config.version,
      host: typeof configValue.host === 'string' ? configValue.host : fallback.config.host,
      port: typeof configValue.port === 'number' ? configValue.port : fallback.config.port,
      dataPath: typeof configValue.dataPath === 'string' ? configValue.dataPath : fallback.config.dataPath,
      collections: safeCollections,
      embeddingEndpoint: typeof configValue.embeddingEndpoint === 'string' ? configValue.embeddingEndpoint : fallback.config.embeddingEndpoint,
      embedder: isRecord(configValue.embedder) && typeof configValue.embedder.backend === 'string'
        ? { backend: configValue.embedder.backend }
        : fallback.config.embedder,
    },
    doc_counts: isRecord(value.doc_counts) ? (value.doc_counts as Record<string, number>) : {},
    health: isRecord(value.health) ? (value.health as Record<string, VectorConfigHealth>) : {},
    checked_at: typeof value.checked_at === 'string' ? value.checked_at : fallback.checked_at,
  };
}

export function toRows(response: VectorConfigResponse): VectorConfigRow[] {
  return Object.entries(response.config.collections)
    .map(([key, item]) => ({
      key,
      collection: item.collection,
      model: item.model,
      provider: item.provider,
      adapter: item.adapter ?? 'lancedb',
      primary: item.primary,
      enabled: item.enabled !== false,
      count: response.doc_counts?.[key],
      health: response.health?.[key],
    }))
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : response.statusText;
    throw new Error(`${path} returned ${response.status}: ${message}`);
  }
  return payload as T;
}
