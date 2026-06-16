import { VECTORS_DB_PATH, LANCEDB_DIR, CHROMADB_DIR } from '../config.ts';
import { COLLECTION_NAME } from '../const.ts';
import type {
  EmbedderConfig,
  VectorStoreAdapter,
  VectorDBType,
  EmbeddingProviderType,
} from './types.ts';
import { ChromaMcpAdapter } from './adapters/chroma-mcp.ts';
import { SqliteVecAdapter } from './adapters/sqlite-vec.ts';
import { LanceDBAdapter } from './adapters/lancedb.ts';
import { QdrantAdapter } from './adapters/qdrant.ts';
import { CloudflareVectorizeAdapter, CloudflareAIEmbeddings } from './adapters/cloudflare-vectorize.ts';
import { ProxyVectorAdapter } from './adapters/proxy.ts';
import { createEmbeddingProvider } from './embeddings.ts';
import { resolveEmbeddingModel, resolveEmbeddingProviderType } from './embedder-config.ts';
import { loadVectorConfig, resolveServiceEndpoint, configToModels, fallbackCollectionsFor } from './config.ts';

export interface VectorStoreConfig {
  type?: VectorDBType;
  collectionName?: string;
  /** ChromaDB data dir, sqlite-vec DB path, or LanceDB directory */
  dataPath?: string;
  pythonVersion?: string;
  embeddingProvider?: EmbeddingProviderType;
  embeddingModel?: string;
  embeddingUrl?: string;
  embeddingDimensions?: number;
  /** Qdrant URL (default: http://localhost:6333) */
  qdrantUrl?: string;
  /** Qdrant API key */
  qdrantApiKey?: string;
  /** Cloudflare account ID */
  cfAccountId?: string;
  /** Cloudflare API token */
  cfApiToken?: string;
  /** Endpoint for proxy adapter */
  proxyEndpoint?: string;
}

export interface EmbeddingModelConfig {
  collection: string;
  model: string;
  adapter?: VectorDBType;
  dataPath?: string;
  embedder?: EmbedderConfig;
  endpoint?: string;
}

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

      const embeddingType = resolveEmbeddingProviderType(config.embeddingProvider);
      const embeddingModel = resolveEmbeddingModel(config.embeddingModel);

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel, {
        url: config.embeddingUrl,
        dimensions: config.embeddingDimensions,
      });
      return new SqliteVecAdapter(collectionName, dbPath, embedder);
    }

    case 'lancedb': {
      const dbPath = config.dataPath
        || process.env.ORACLE_VECTOR_DB_PATH
        || LANCEDB_DIR;

      const embeddingType = resolveEmbeddingProviderType(config.embeddingProvider);
      const embeddingModel = resolveEmbeddingModel(config.embeddingModel);

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel, {
        url: config.embeddingUrl,
        dimensions: config.embeddingDimensions,
      });
      return new LanceDBAdapter(collectionName, dbPath, embedder);
    }

    case 'qdrant': {
      const embeddingType = resolveEmbeddingProviderType(config.embeddingProvider);
      const embeddingModel = resolveEmbeddingModel(config.embeddingModel);

      const embedder = createEmbeddingProvider(embeddingType, embeddingModel, {
        url: config.embeddingUrl,
        dimensions: config.embeddingDimensions,
      });
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

    case 'proxy': {
      const proxyUrl = config.proxyEndpoint || process.env.ORACLE_PROXY_VECTOR_URL;
      if (!proxyUrl) {
        throw new Error('proxy vector adapter requires proxyEndpoint or ORACLE_PROXY_VECTOR_URL');
      }
      return new ProxyVectorAdapter(collectionName, proxyUrl);
    }

    case 'chroma':
    default: {
      const dataPath = config.dataPath || CHROMADB_DIR;
      const pythonVersion = config.pythonVersion || '3.12';
      return new ChromaMcpAdapter(collectionName, dataPath, pythonVersion);
    }
  }
}

export function getEmbeddingModels(
  cfg: ReturnType<typeof loadVectorConfig> = loadVectorConfig(),
): Record<string, EmbeddingModelConfig> {
  const fallbackFromFallbackCollections = cfg ? fallbackCollectionsFor(cfg) : [];

  if (cfg && Object.keys(cfg.collections).length > 0) return configToModels(cfg);

    if (cfg && fallbackFromFallbackCollections.length > 0) {
    const modelMap: Record<string, EmbeddingModelConfig> = {};
    for (const col of fallbackFromFallbackCollections) {
      const serviceName = col.service;
      const storageService = serviceName ? cfg.storage?.services[serviceName] : undefined;
      modelMap[col.collection] = {
        collection: col.collection,
        model: col.model,
        adapter: storageService?.type === 'proxy' ? 'proxy' : 'lancedb',
        endpoint: resolveServiceEndpoint(cfg, serviceName),
      };
    }
    return modelMap;
  }

  if (cfg) return configToModels(cfg);

  // Hardcoded fallback — always works even without config file
  return {
    nomic: {
      collection: COLLECTION_NAME,
      model: 'nomic-embed-text',
      adapter: 'lancedb',
      dataPath: LANCEDB_DIR,
    },
    qwen3: {
      collection: 'oracle_knowledge_qwen3',
      model: 'qwen3-embedding',
      adapter: 'lancedb',
      dataPath: LANCEDB_DIR,
    },
    'bge-m3': {
      collection: 'oracle_knowledge_bge_m3',
      model: 'bge-m3',
      adapter: 'lancedb',
      dataPath: LANCEDB_DIR,
    },
  };
}

export const EMBEDDING_MODELS = new Proxy({} as Record<string, EmbeddingModelConfig>, {
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

const connectPromises = new Map<string, Promise<void>>();

export function createVectorStoreForModel(preset: EmbeddingModelConfig): VectorStoreAdapter {
  return createVectorStore({
    type: preset.adapter || 'lancedb',
    collectionName: preset.collection,
    embeddingProvider: preset.embedder?.backend ?? resolveEmbeddingProviderType(),
    embeddingModel: preset.embedder?.model || preset.model,
    embeddingUrl: preset.embedder?.url,
    embeddingDimensions: preset.embedder?.dimensions,
    proxyEndpoint: preset.endpoint,
    ...(preset.dataPath && { dataPath: preset.dataPath }),
  });
}

export function getVectorStoreByModel(
  model?: string,
  models = getEmbeddingModels(),
  connectStore: (store: VectorStoreAdapter) => Promise<void> = (store) => store.connect(),
): VectorStoreAdapter {
  const key = model && models[model] ? model : 'bge-m3';
  let store = modelStoreCache.get(key);
  if (!store) {
    const preset = models[key];
    store = createVectorStoreForModel(preset);
    modelStoreCache.set(key, store);
    connectPromises.set(key, connectStore(store).catch(e =>
      console.warn(`[VectorRegistry] Failed to connect ${key}:`, e instanceof Error ? e.message : String(e))
    ));
  }
  return store;
}

export async function ensureVectorStoreConnected(
  model?: string,
  models = getEmbeddingModels(),
): Promise<VectorStoreAdapter> {
  const key = model && models[model] ? model : 'bge-m3';
  const store = getVectorStoreByModel(model, models);
  const pending = connectPromises.get(key);
  if (pending) await pending;
  return store;
}

export async function closeCachedVectorStores(): Promise<void> {
  const stores = [...modelStoreCache.values()];
  modelStoreCache.clear(); connectPromises.clear();
  await Promise.all(stores.map((store) => store.close().catch((e) =>
    console.warn(`[VectorRegistry] Failed to close ${store.name}:`, e instanceof Error ? e.message : String(e))
  )));
}
