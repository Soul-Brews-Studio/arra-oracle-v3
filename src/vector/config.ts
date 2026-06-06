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
import type { VectorDBType } from './types.ts';

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
  embeddingEndpoint: string;
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
    host: '0.0.0.0',
    port: 8081,
    collections: {
      'bge-m3': {
        collection: 'oracle_knowledge_bge_m3',
        model: 'bge-m3',
        provider: 'ollama',
        adapter: 'lancedb',
        primary: true,
      },
      nomic: {
        collection: COLLECTION_NAME,
        model: 'nomic-embed-text',
        provider: 'ollama',
        adapter: 'lancedb',
      },
      qwen3: {
        collection: 'oracle_knowledge_qwen3',
        model: 'qwen3-embedding',
        provider: 'ollama',
        adapter: 'lancedb',
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
  fs.writeFileSync(fp, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return fp;
}

/**
 * Derive the getEmbeddingModels()-compatible registry from a VectorServerConfig.
 * Used by factory.ts to let the config file override hardcoded models.
 */
export function configToModels(
  config: VectorServerConfig,
): Record<string, { collection: string; model: string; adapter?: VectorDBType; dataPath?: string }> {
  const out: Record<string, { collection: string; model: string; adapter?: VectorDBType; dataPath?: string }> = {};
  for (const [key, col] of Object.entries(config.collections)) {
    out[key] = {
      collection: col.collection,
      model: col.model,
      adapter: col.adapter || 'lancedb',
      dataPath: config.dataPath || undefined,
    };
  }
  return out;
}
