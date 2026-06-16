/**
 * Vector Server Configuration — reads / writes vector-server.json.
 *
 * Phase 2 of #1071: the config file describes collections, models,
 * and deployment settings for the standalone vector server (Phase 3).
 *
 * The file is optional. When absent, getEmbeddingModels() returns
 * hardcoded defaults. When present, it's the source of truth.
 */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR, LANCEDB_DIR } from '../config.ts';
import { COLLECTION_NAME } from '../const.ts';
import type { UnifiedProxyManifest } from '../plugins/unified-manifest.ts';
import type { EmbedderConfig, VectorDBType } from './types.ts';
import { zeroConfigEmbedder } from './default-embedder.ts';
import { normalizeVectorConfig } from './config-normalize.ts';

export const VECTOR_CONFIG_FILE = 'vector-server.json';

export interface VectorStorageService {
  type: 'builtin' | 'proxy';
  endpoint?: string;
  capabilities?: Record<string, unknown>;
}

export interface VectorStorageConfig {
  default: string;
  services: Record<string, VectorStorageService>;
}

export interface VectorServerV2Storage {
  storage: VectorStorageConfig;
}

export interface VectorCollectionConfig {
  collection: string;
  model: string;
  provider: string;
  /** Vector adapter for this collection. Defaults to lancedb for embedded Bun. */
  adapter?: VectorDBType;
  service?: string;
  /** Explicit endpoint for proxy adapter (optional, defaults to registered service). */
  endpoint?: string;
  enabled?: boolean;
  primary?: boolean;
  embedder?: EmbedderConfig;
}

export interface VectorServerConfig {
  version: '1' | '1.0' | '2' | '2.0' | 'legacy';
  host: string;
  port: number;
  collections: Record<string, VectorCollectionConfig>;
  dataPath: string;
  /** Default is none: semantic failures fall back to SQLite FTS5. */
  embedder?: EmbedderConfig;
  embeddingEndpoint: string;
  storage?: VectorStorageConfig;
  proxy?: VectorProxyManifest[];
}

export type VectorProxyManifest = UnifiedProxyManifest;

/** Absolute path to vector-server.json inside ORACLE_DATA_DIR. */
export function configPath(dataDir = process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR): string {
  return path.join(dataDir, VECTOR_CONFIG_FILE);
}

/**
 * Generate the default config from the hardcoded EMBEDDING_MODELS registry.
 * This is the "factory" version — users can tweak after writing to disk.
 */
export function generateDefaultConfig(): VectorServerConfig {
  return {
    version: '1.0',
    host: '0.0.0.0',
    port: 8081,
    collections: {
      'bge-m3': {
        collection: 'oracle_knowledge_bge_m3',
        model: 'bge-m3',
        provider: 'ollama',
        adapter: 'lancedb',
        primary: true,
        embedder: zeroConfigEmbedder('bge-m3'),
      },
      nomic: {
        collection: COLLECTION_NAME,
        model: 'nomic-embed-text',
        provider: 'ollama',
        adapter: 'lancedb',
        embedder: zeroConfigEmbedder('nomic-embed-text'),
      },
      qwen3: {
        collection: 'oracle_knowledge_qwen3',
        model: 'qwen3-embedding',
        provider: 'ollama',
        adapter: 'lancedb',
        embedder: zeroConfigEmbedder('qwen3-embedding'),
      },
    },
    dataPath: LANCEDB_DIR,
    embeddingEndpoint: '',
    storage: {
      default: 'lancedb',
      services: {
        lancedb: { type: 'builtin' },
      },
    },
    proxy: defaultVectorProxyManifest(),
  };
}

export function defaultVectorProxyManifest(): VectorProxyManifest[] {
  return [{
    path: '/api/vector-db',
    targetEnv: 'VECTOR_DB_URL',
    stripPrefix: true,
  }];
}

/**
 * Load vector-server.json from ORACLE_DATA_DIR.
 * Returns null if the file doesn't exist or is unparseable.
 */
export function loadVectorConfig(fp = configPath()): VectorServerConfig | null {
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return normalizeVectorConfig(JSON.parse(raw), generateDefaultConfig());
  } catch (e) {
    console.warn('[VectorConfig] Failed to parse ' + fp + ':', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Write vector-server.json to ORACLE_DATA_DIR.
 * Creates the directory if needed.
 */
export function writeVectorConfig(config: VectorServerConfig, fp = configPath()): string {
  fs.writeFileSync(fp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return fp;
}

function embedderFor(config: VectorServerConfig, col: VectorCollectionConfig): EmbedderConfig | undefined {
  const generated = col.embedder?.backend === 'ollama' && col.embedder.model === col.model && col.provider === 'ollama';
  const merged = config.embedder && generated ? { ...col.embedder, ...config.embedder }
    : config.embedder || col.embedder ? { ...config.embedder, ...col.embedder } : undefined;
  const primary = col.embedder && !generated
    ? col.embedder.backend ?? col.embedder.default ?? config.embedder?.backend ?? config.embedder?.default
    : config.embedder?.backend ?? config.embedder?.default ?? col.embedder?.backend ?? col.embedder?.default;
  if (merged) return {
    ...merged,
    backend: primary ?? 'none',
    model: merged.model ?? col.model,
  };
  const provider = col.provider.toLowerCase();
  if (provider === 'ollama' || provider === 'local') return { backend: 'local', model: col.model };
  if (provider === 'openai' || provider === 'gemini' || provider === 'cloudflare-ai') {
    return { backend: provider, model: col.model };
  }
  if (provider === 'remote') return { backend: 'remote', model: col.model };
  if (provider === 'none') return { backend: 'none' };
  return undefined;
}

/**
 * Derive the getEmbeddingModels()-compatible registry from a VectorServerConfig.
 * Used by factory.ts to let the config file override hardcoded models.
 */
export function configToModels(
  config: VectorServerConfig,
): Record<string, {
  collection: string;
  model: string;
  adapter?: VectorDBType;
  dataPath?: string;
  embedder?: EmbedderConfig;
  service?: string;
  endpoint?: string;
}> {
  const out: Record<string, {
    collection: string;
    model: string;
    adapter?: VectorDBType;
    dataPath?: string;
    embedder?: EmbedderConfig;
    service?: string;
    endpoint?: string;
  }> = {};
  for (const [key, col] of Object.entries(config.collections)) {
    if (col.enabled === false) continue;
    const adapter = col.adapter || 'lancedb';
    const serviceEndpoint = col.endpoint
      || resolveServiceEndpoint(config, col.service)
      || (col.service && col.service !== 'lancedb' ? undefined : undefined);

    out[key] = {
      collection: col.collection,
      model: col.model,
      adapter,
      service: col.service,
      endpoint: serviceEndpoint,
      dataPath: config.dataPath || undefined,
      embedder: embedderFor(config, col),
    };
  }
  return out;
}

export function isV2Config(config: VectorServerConfig): boolean {
  return config.version.startsWith('2') || Boolean(config.storage);
}

export function getBuiltInStorageService(config: VectorServerConfig): VectorStorageConfig | null {
  const storage = config.storage;
  if (!storage) return null;
  const primary = storage.services[storage.default];
  if (!primary || primary.type !== 'builtin') return null;
  return storage;
}

export function resolveServiceEndpoint(config: VectorServerConfig, serviceName?: string): string | undefined {
  if (!serviceName) return undefined;
  const svc = config.storage?.services[serviceName];
  if (!svc || svc.type !== 'proxy') return undefined;
  return svc.endpoint;
}

export function fallbackCollectionsFor(config: VectorServerConfig): VectorCollectionConfig[] {
  if (Object.keys(config.collections).length > 0) return [];
  if (!config.storage) return [];

  const storageService = getBuiltInStorageService(config);
  if (!storageService) return [];

  return Object.entries(storageService.services)
    .filter(([, svc]) => svc.type === 'builtin')
    .map(([name]) => ({
      collection: `oracle_knowledge_${name.replace(/[^a-z0-9]+/g, '_')}`,
      model: 'bge-m3',
      provider: 'none',
      adapter: 'lancedb',
      service: name,
      primary: name === storageService.default,
    }));
}
