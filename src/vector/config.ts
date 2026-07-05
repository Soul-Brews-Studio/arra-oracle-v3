/**
 * Vector Server Configuration — reads / writes vector-server.json.
 *
 * Phase 2 of #1071: the config file describes collections, models,
 * and deployment settings for the standalone vector server (Phase 3).
 *
 * The file is optional. When absent, getEmbeddingModels() returns the
 * default-safe sqlite-vec config. When present, it's the source of truth.
 */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';
import { DEFAULT_SAFE_VECTOR_ENGINE, DEFAULT_VECTOR_LOCAL_ENGINES } from '../config/defaults.ts';
import { COLLECTION_NAME, LANCEDB_DIR_NAME, VECTORS_DB_FILE } from '../const.ts';
import type { VectorDBType } from './types.ts';
import type { LocalVectorEngine, VectorCollectionConfig, VectorConfigUpdate, VectorProxyManifest, VectorServerConfig, VectorStorageConfig } from './config-types.ts';
import { zeroConfigEmbedder } from './default-embedder.ts';
import { normalizeVectorConfig } from './config-normalize.ts';

export const VECTOR_CONFIG_FILE = 'vector-server.json';
export const LOCAL_VECTOR_ENGINES = DEFAULT_VECTOR_LOCAL_ENGINES;
export type { LocalVectorEngine, VectorCollectionConfig, VectorConfigUpdate, VectorProxyManifest, VectorServerConfig, VectorServerV2Storage, VectorStorageConfig, VectorStorageService, VectorModelRegistryEntry } from './config-types.ts';
export { configToModels, resolveServiceEndpoint } from './config-models.ts';

function currentDataDir(): string {
  return process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR;
}

function defaultLanceDbDir(): string {
  return path.join(currentDataDir(), LANCEDB_DIR_NAME);
}

function defaultVectorsDbPath(): string {
  return path.join(currentDataDir(), VECTORS_DB_FILE);
}

/** Absolute path to vector-server.json inside ORACLE_DATA_DIR. */
export function configPath(dataDir = process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR): string {
  return path.join(dataDir, VECTOR_CONFIG_FILE);
}

/**
 * Generate the default config from the hardcoded EMBEDDING_MODELS registry.
 * This is the "factory" version — users can tweak after writing to disk.
 */
export function generateDefaultConfig(): VectorServerConfig {
  const adapter = DEFAULT_SAFE_VECTOR_ENGINE;
  const dataPath = defaultDataPathForEngine(adapter);
  return {
    version: '1.0',
    enabled: false,
    host: '0.0.0.0',
    port: 8081,
    collections: {
      'bge-m3': {
        collection: 'oracle_knowledge_bge_m3',
        model: 'bge-m3',
        provider: 'ollama',
        adapter,
        primary: true,
        embedder: zeroConfigEmbedder('bge-m3'),
      },
      nomic: {
        collection: COLLECTION_NAME,
        model: 'nomic-embed-text',
        provider: 'ollama',
        adapter,
        embedder: zeroConfigEmbedder('nomic-embed-text'),
      },
      qwen3: {
        collection: 'oracle_knowledge_qwen3',
        model: 'qwen3-embedding',
        provider: 'ollama',
        adapter,
        embedder: zeroConfigEmbedder('qwen3-embedding'),
      },
    },
    dataPath,
    embeddingEndpoint: '',
    storage: {
      default: adapter,
      services: {
        [adapter]: { type: 'builtin' },
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
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return fp;
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

export function isLocalVectorEngine(value: unknown): value is LocalVectorEngine {
  return typeof value === 'string' && (LOCAL_VECTOR_ENGINES as readonly string[]).includes(value);
}

export function defaultDataPathForEngine(engine: LocalVectorEngine): string {
  if (engine === 'sqlite-vec') return defaultVectorsDbPath();
  if (engine === 'qdrant') return '';
  return defaultLanceDbDir();
}

export function activeVectorEngine(config: VectorServerConfig): VectorDBType {
  const primary = Object.values(config.collections).find(c => c.primary);
  return primary?.adapter || Object.values(config.collections)[0]?.adapter || 'lancedb';
}

export function applyVectorConfigUpdate(
  base: VectorServerConfig,
  update: VectorConfigUpdate,
): VectorServerConfig {
  const next: VectorServerConfig = structuredClone(base);

  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.engine !== undefined) {
    if (!isLocalVectorEngine(update.engine)) throw new Error(`Unsupported local vector engine: ${String(update.engine)}`);
    next.dataPath = update.dataPath ?? defaultDataPathForEngine(update.engine);
    for (const collection of Object.values(next.collections)) {
      collection.adapter = update.engine;
      if (update.engine === 'qdrant') delete collection.dataPath;
      else collection.dataPath = collection.dataPath || next.dataPath;
    }
  } else if (update.dataPath !== undefined) {
    next.dataPath = update.dataPath;
  }

  if (update.embeddingEndpoint !== undefined) next.embeddingEndpoint = update.embeddingEndpoint;
  if (update.vectorProxyUrl !== undefined) {
    const trimmed = update.vectorProxyUrl.trim();
    if (trimmed) next.vectorProxyUrl = trimmed.replace(/\/+$/, '');
    else delete next.vectorProxyUrl;
  }

  for (const [key, patch] of Object.entries(update.collections ?? {})) {
    if (!key.trim()) throw new Error('Collection key cannot be empty');
    const existing = next.collections[key] ?? {
      collection: key,
      model: key,
      provider: 'ollama',
      adapter: update.engine ?? activeVectorEngine(next),
    };
    if (patch.adapter !== undefined && !isLocalVectorEngine(patch.adapter)) {
      throw new Error(`Unsupported local vector engine: ${String(patch.adapter)}`);
    }
    next.collections[key] = {
      ...existing,
      ...patch,
      collection: patch.collection ?? existing.collection ?? key,
      model: patch.model ?? existing.model ?? key,
      provider: patch.provider ?? existing.provider ?? 'ollama',
      adapter: patch.adapter ?? existing.adapter ?? update.engine ?? activeVectorEngine(next),
    };
  }

  const primaryKeys = Object.entries(next.collections).filter(([, c]) => c.primary).map(([key]) => key);
  if (primaryKeys.length === 0 && next.collections['bge-m3']) next.collections['bge-m3'].primary = true;
  if (primaryKeys.length > 1) {
    const keep = primaryKeys[0];
    for (const [key, collection] of Object.entries(next.collections)) collection.primary = key === keep;
  }
  return next;
}

export function isVectorSectionEnabled(config: VectorServerConfig | null = loadVectorConfig()): boolean {
  return config?.enabled === true || process.env.ORACLE_VECTOR_ENABLED === '1';
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
      adapter: isLocalVectorEngine(name) ? name : DEFAULT_SAFE_VECTOR_ENGINE,
      service: name,
      primary: name === storageService.default,
    }));
}
