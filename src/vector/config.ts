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
import { ORACLE_DATA_DIR, LANCEDB_DIR, VECTORS_DB_PATH } from '../config.ts';
import { COLLECTION_NAME } from '../const.ts';
import type { EmbeddingProviderType, VectorDBType } from './types.ts';

export const VECTOR_CONFIG_FILE = 'vector-server.json';
export const LOCAL_VECTOR_ENGINES = ['lancedb', 'qdrant', 'sqlite-vec'] as const;
export type LocalVectorEngine = typeof LOCAL_VECTOR_ENGINES[number];

export interface VectorCollectionConfig {
  collection: string;
  model: string;
  provider: EmbeddingProviderType;
  adapter?: VectorDBType;
  dataPath?: string;
  pythonVersion?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  cfAccountId?: string;
  cfApiToken?: string;
  primary?: boolean;
}


export interface VectorConfigUpdateCollection {
  collection?: string;
  model?: string;
  provider?: EmbeddingProviderType;
  adapter?: LocalVectorEngine;
  dataPath?: string;
  pythonVersion?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  primary?: boolean;
}

export interface VectorConfigUpdate {
  enabled?: boolean;
  engine?: LocalVectorEngine;
  dataPath?: string;
  embeddingEndpoint?: string;
  /** Remote vector service base URL for backend-to-backend VECTOR_URL proxying. */
  vectorProxyUrl?: string;
  collections?: Record<string, VectorConfigUpdateCollection>;
}

export interface VectorServerConfig {
  version: string;
  enabled?: boolean;
  host: string;
  port: number;
  /** Optional remote vector service base URL used by core server proxy mode. */
  vectorProxyUrl?: string;
  collections: Record<string, VectorCollectionConfig>;
  dataPath: string;
  embeddingEndpoint: string;
}

export interface VectorModelRegistryEntry {
  collection: string;
  model: string;
  dataPath?: string;
  adapter?: VectorDBType;
  provider?: EmbeddingProviderType;
  pythonVersion?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  cfAccountId?: string;
  cfApiToken?: string;
}

/** Absolute path to vector-server.json inside ORACLE_DATA_DIR. */
export function configPath(): string {
  return path.join(ORACLE_DATA_DIR, VECTOR_CONFIG_FILE);
}

/**
 * Generate the default config from the hardcoded EMBEDDING_MODELS registry.
 * This is the "factory" version — users can tweak after writing to disk.
 */
export function generateDefaultConfig(): VectorServerConfig {
  return {
    version: '1.0',
    enabled: false,
    host: '0.0.0.0',
    port: 8081,
    collections: {
      'bge-m3': {
        adapter: 'lancedb',
        collection: 'oracle_knowledge_bge_m3',
        model: 'bge-m3',
        provider: 'ollama',
        primary: true,
      },
      nomic: {
        adapter: 'lancedb',
        collection: COLLECTION_NAME,
        model: 'nomic-embed-text',
        provider: 'ollama',
      },
      qwen3: {
        adapter: 'lancedb',
        collection: 'oracle_knowledge_qwen3',
        model: 'qwen3-embedding',
        provider: 'ollama',
      },
    },
    dataPath: LANCEDB_DIR,
    embeddingEndpoint: 'http://localhost:11434',
  };
}

/**
 * Load vector-server.json from ORACLE_DATA_DIR.
 * Returns null if the file doesn't exist or is unparseable.
 */
export function loadVectorConfig(): VectorServerConfig | null {
  const fp = configPath();
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw) as VectorServerConfig;
  } catch (e) {
    console.warn('[VectorConfig] Failed to parse ' + fp + ':', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Write vector-server.json to ORACLE_DATA_DIR.
 * Creates the directory if needed.
 */
export function writeVectorConfig(config: VectorServerConfig): string {
  const fp = configPath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return fp;
}

/**
 * Derive the getEmbeddingModels()-compatible registry from a VectorServerConfig.
 * Used by factory.ts to let the config file override hardcoded models.
 */
export function configToModels(
  config: VectorServerConfig,
): Record<string, VectorModelRegistryEntry> {
  const out: Record<string, VectorModelRegistryEntry> = {};
  for (const [key, col] of Object.entries(config.collections)) {
    out[key] = {
      collection: col.collection,
      model: col.model,
      adapter: col.adapter,
      provider: col.provider,
      dataPath: col.dataPath || config.dataPath || undefined,
      pythonVersion: col.pythonVersion,
      qdrantUrl: col.qdrantUrl,
      qdrantApiKey: col.qdrantApiKey,
      cfAccountId: col.cfAccountId,
      cfApiToken: col.cfApiToken,
    };
  }
  return out;
}


export function isLocalVectorEngine(value: unknown): value is LocalVectorEngine {
  return typeof value === 'string' && (LOCAL_VECTOR_ENGINES as readonly string[]).includes(value);
}

export function defaultDataPathForEngine(engine: LocalVectorEngine): string {
  if (engine === 'sqlite-vec') return VECTORS_DB_PATH;
  if (engine === 'qdrant') return '';
  return LANCEDB_DIR;
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
    if (!isLocalVectorEngine(update.engine)) {
      throw new Error(`Unsupported local vector engine: ${String(update.engine)}`);
    }
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
      provider: 'ollama' as EmbeddingProviderType,
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
