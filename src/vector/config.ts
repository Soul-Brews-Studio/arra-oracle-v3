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

export const VECTOR_CONFIG_FILE = 'vector-server.json';

export interface VectorCollectionConfig {
  collection: string;
  model: string;
  provider: string;
  /** Vector adapter for this collection. Defaults to lancedb for embedded Bun. */
  adapter?: VectorDBType;
  primary?: boolean;
}

export interface VectorServerConfig {
  version: string;
  host: string;
  port: number;
  collections: Record<string, VectorCollectionConfig>;
  dataPath: string;
  /** Default is none: semantic failures fall back to SQLite FTS5. */
  embedder?: EmbedderConfig;
  embeddingEndpoint: string;
  proxy?: VectorProxyManifest[];
}

export type VectorProxyManifest = UnifiedProxyManifest;

/** Absolute path to vector-server.json inside ORACLE_DATA_DIR. */
export function configPath(dataDir = ORACLE_DATA_DIR): string {
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
        provider: 'none',
        adapter: 'lancedb',
        primary: true,
      },
      nomic: {
        collection: COLLECTION_NAME,
        model: 'nomic-embed-text',
        provider: 'none',
        adapter: 'lancedb',
      },
      qwen3: {
        collection: 'oracle_knowledge_qwen3',
        model: 'qwen3-embedding',
        provider: 'none',
        adapter: 'lancedb',
      },
    },
    dataPath: LANCEDB_DIR,
    embedder: { backend: 'none' },
    embeddingEndpoint: '',
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
export function writeVectorConfig(config: VectorServerConfig, fp = configPath()): string {
  fs.writeFileSync(fp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return fp;
}

function embedderFor(config: VectorServerConfig, col: VectorCollectionConfig): EmbedderConfig | undefined {
  if (config.embedder) return { ...config.embedder, model: config.embedder.model ?? col.model };
  const provider = col.provider.toLowerCase();
  if (provider === 'ollama' || provider === 'local') return { backend: 'local', model: col.model };
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
}> {
  const out: Record<string, {
    collection: string;
    model: string;
    adapter?: VectorDBType;
    dataPath?: string;
    embedder?: EmbedderConfig;
  }> = {};
  for (const [key, col] of Object.entries(config.collections)) {
    out[key] = {
      collection: col.collection,
      model: col.model,
      adapter: col.adapter || 'lancedb',
      dataPath: config.dataPath || undefined,
      embedder: embedderFor(config, col),
    };
  }
  return out;
}
