/**
 * Vector Store Factory
 *
 * Creates the right VectorStoreAdapter + EmbeddingProvider from env vars.
 * Supports model-based registry for multi-index (bge-m3 default, nomic, qwen3).
 */

import path from 'path';
import { VECTORS_DB_PATH, LANCEDB_DIR, CHROMADB_DIR } from '../config.ts';
import { COLLECTION_NAME } from '../const.ts';
import type { VectorStoreAdapter, VectorDBType, EmbeddingProviderType } from './types.ts';
import { ChromaMcpAdapter } from './adapters/chroma-mcp.ts';
import { SqliteVecAdapter } from './adapters/sqlite-vec.ts';
import { LanceDBAdapter } from './adapters/lancedb.ts';
import { QdrantAdapter } from './adapters/qdrant.ts';
import { CloudflareVectorizeAdapter, CloudflareAIEmbeddings } from './adapters/cloudflare-vectorize.ts';
import { createEmbeddingProvider } from './embeddings.ts';

export interface VectorStoreConfig {
  type?: VectorDBType;
  collectionName?: string;
  /** ChromaDB data dir, sqlite-vec DB path, or LanceDB directory */
  dataPath?: string;
  pythonVersion?: string;
  embeddingProvider?: EmbeddingProviderType;
  embeddingModel?: string;
  /** Qdrant URL (default: http://localhost:6333) */
  qdrantUrl?: string;
  /** Qdrant API key */
  qdrantApiKey?: string;
  /** Cloudflare account ID */
  cfAccountId?: string;
  /** Cloudflare API token */
  cfApiToken?: string;
}

/**
 * Create a VectorStoreAdapter from config or env vars.
 *
 * Env vars:
 *   ORACLE_VECTOR_DB          = 'chroma' | 'sqlite-vec' | 'lancedb' | 'qdrant' | 'cloudflare-vectorize'
 *   ORACLE_EMBEDDING_PROVIDER = 'chromadb-internal' | 'ollama' | 'openai' | 'cloudflare-ai'
 *   ORACLE_EMBEDDING_MODEL    = model name override
 *   ORACLE_VECTOR_DB_PATH     = sqlite-vec / lancedb path
 *   CLOUDFLARE_ACCOUNT_ID     = CF account (for cloudflare-vectorize)
 *   CLOUDFLARE_API_TOKEN      = CF API token (for cloudflare-vectorize)
 */
export function createVectorStore(config: VectorStoreConfig = {}): VectorStoreAdapter {
  const type = config.type
    || (process.env.ORACLE_VECTOR_DB as VectorDBType)
    || 'lancedb';

  const collectionName = config.collectionName || COLLECTION_NAME;

  switch (type) {
    case 'sqlite-vec': {
      const dbPath = config.dataPath
        || process.env.ORACLE_VECTOR_DB_PATH
        || VECTORS_DB_PATH;

      const embeddingType = config.embeddingProvider
        || (process.env.ORACLE_EMBEDDING_PROVIDER as EmbeddingProviderType)
        || 'ollama';

      const embeddingModel = config.embeddingModel
        || process.env.ORACLE_EMBEDDING_MODEL;

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel);
      return new SqliteVecAdapter(collectionName, dbPath, embedder);
    }

    case 'lancedb': {
      const dbPath = config.dataPath
        || process.env.ORACLE_VECTOR_DB_PATH
        || LANCEDB_DIR;

      const embeddingType = config.embeddingProvider
        || (process.env.ORACLE_EMBEDDING_PROVIDER as EmbeddingProviderType)
        || 'ollama';

      const embeddingModel = config.embeddingModel
        || process.env.ORACLE_EMBEDDING_MODEL;

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel);
      return new LanceDBAdapter(collectionName, dbPath, embedder);
    }

    case 'qdrant': {
      const embeddingType = config.embeddingProvider
        || (process.env.ORACLE_EMBEDDING_PROVIDER as EmbeddingProviderType)
        || 'ollama';

      const embeddingModel = config.embeddingModel
        || process.env.ORACLE_EMBEDDING_MODEL;

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel);
      return new QdrantAdapter(collectionName, embedder, {
        url: config.qdrantUrl || process.env.QDRANT_URL,
        apiKey: config.qdrantApiKey || process.env.QDRANT_API_KEY,
      });
    }

    case 'cloudflare-vectorize': {
      const cfConfig = {
        accountId: config.cfAccountId || process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: config.cfApiToken || process.env.CLOUDFLARE_API_TOKEN,
      };

      const embeddingModel = config.embeddingModel
        || process.env.ORACLE_EMBEDDING_MODEL;

      // Default to Cloudflare AI embeddings (same platform, zero egress)
      const embedder = new CloudflareAIEmbeddings({
        ...cfConfig,
        model: embeddingModel,
      });

      return new CloudflareVectorizeAdapter(collectionName, embedder, cfConfig);
    }

    case 'chroma':
    default: {
      const dataPath = config.dataPath || CHROMADB_DIR;
      const pythonVersion = config.pythonVersion || '3.12';
      return new ChromaMcpAdapter(collectionName, dataPath, pythonVersion);
    }
  }
}

// ============================================================================
// Model-based registry for dual-index search
// ============================================================================

export function getEmbeddingModels(): Record<string, { collection: string; model: string; dataPath?: string }> {
  return {
    nomic: {
      collection: COLLECTION_NAME,
      model: 'nomic-embed-text',
      dataPath: LANCEDB_DIR,
    },
    qwen3: {
      collection: 'oracle_knowledge_qwen3',
      model: 'qwen3-embedding',
      dataPath: LANCEDB_DIR,
    },
    'bge-m3': {
      collection: 'oracle_knowledge_bge_m3',
      model: 'bge-m3',
      dataPath: LANCEDB_DIR,
    },
  };
}

/** @deprecated Use getEmbeddingModels() — kept for backward compat */
export const EMBEDDING_MODELS = new Proxy({} as Record<string, { collection: string; model: string; dataPath?: string }>, {
  get(_, prop: string) { return getEmbeddingModels()[prop]; },
  has(_, prop: string) { return prop in getEmbeddingModels(); },
  ownKeys() { return Object.keys(getEmbeddingModels()); },
  getOwnPropertyDescriptor(_, prop: string) {
    const models = getEmbeddingModels();
    if (prop in models) return { configurable: true, enumerable: true, value: models[prop] };
    return undefined;
  },
});

const modelStoreCache = new Map<string, VectorStoreAdapter>();

/**
 * Get a vector store for a specific embedding model.
 * Uses LanceDB + Ollama. Caches instances by model key.
 */
const connectPromises = new Map<string, Promise<void>>();

export function getVectorStoreByModel(model?: string): VectorStoreAdapter {
  const models = getEmbeddingModels();
  const key = model && models[model] ? model : 'bge-m3';
  let store = modelStoreCache.get(key);
  if (!store) {
    const preset = models[key];
    store = createVectorStore({
      type: 'lancedb',
      collectionName: preset.collection,
      embeddingProvider: 'ollama',
      embeddingModel: preset.model,
      ...(preset.dataPath && { dataPath: preset.dataPath }),
    });
    modelStoreCache.set(key, store);
    // Auto-connect in background (non-blocking)
    connectPromises.set(key, store.connect().catch(e =>
      console.warn(`[VectorRegistry] Failed to connect ${key}:`, e instanceof Error ? e.message : String(e))
    ));
  }
  return store;
}

/** Ensure a model's store is connected. Call before first query. */
export async function ensureVectorStoreConnected(model?: string): Promise<VectorStoreAdapter> {
  const models = getEmbeddingModels();
  const key = model && models[model] ? model : 'bge-m3';
  const store = getVectorStoreByModel(model);
  const pending = connectPromises.get(key);
  if (pending) await pending;
  return store;
}
