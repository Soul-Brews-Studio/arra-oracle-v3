import { VECTORS_DB_PATH, LANCEDB_DIR, CHROMADB_DIR } from '../config.ts';
import { COLLECTION_NAME } from '../const.ts';
import type { VectorStoreAdapter } from './adapter.ts';
import type { EmbedderConfig, VectorDBType, EmbeddingProviderType, EmbeddingProvider } from './types.ts';
import { ChromaMcpAdapter } from './adapters/chroma-mcp.ts';
import { SqliteVecAdapter } from './adapters/sqlite-vec.ts';
import { LanceDBAdapter } from './adapters/lancedb.ts';
import { QdrantAdapter } from './adapters/qdrant.ts';
import { createCloudflareVectorStore, type CloudflareAIWorkerBinding, type CloudflareD1Database, type CloudflareVectorizeBinding } from './adapters/cloudflare.ts';
import { ProxyVectorAdapter } from './adapters/proxy.ts';
import { requireVectorProxyContract } from './proxy-contract.ts';
import { TurboVecAdapter } from './adapters/turbovec.ts';
import { createEmbeddingProvider, FallbackEmbeddings } from './embeddings.ts';
import { GeminiEmbeddings } from './providers/gemini.ts';
import { resolveEmbeddingFallbackChain, resolveEmbeddingModel, resolveEmbeddingProviderType } from './embedder-config.ts';
import { configPath, loadVectorConfig, resolveServiceEndpoint, configToModels, fallbackCollectionsFor } from './config.ts';
import { tenantDataPath } from '../middleware/tenant.ts';
import { withEmbedderIdentityGuard } from './embedder-identity.ts';

export type { VectorStoreAdapter } from './adapter.ts';
export interface VectorStoreConfig {
  type?: VectorDBType;
  collectionName?: string;
  dataPath?: string;
  pythonVersion?: string;
  embeddingProvider?: EmbeddingProviderType;
  embeddingModel?: string;
  embeddingUrl?: string;
  embeddingDimensions?: number;
  embeddingFallbackChain?: EmbeddingProviderType[];
  qdrantUrl?: string;
  qdrantApiKey?: string;
  cfAccountId?: string;
  cfApiToken?: string;
  cfAi?: CloudflareAIWorkerBinding;
  cfVectorize?: CloudflareVectorizeBinding;
  cfD1?: CloudflareD1Database;
  cfD1Table?: string;
  proxyEndpoint?: string;
}
export interface EmbeddingModelConfig {
  collection: string; model: string; adapter?: VectorDBType; dataPath?: string; embedder?: EmbedderConfig;
  provider?: string; endpoint?: string; pythonVersion?: string; qdrantUrl?: string; qdrantApiKey?: string;
  cfAccountId?: string; cfApiToken?: string;
}
function createConfiguredEmbedder(config: VectorStoreConfig) {
  const provider = resolveEmbeddingProviderType(config.embeddingProvider ?? (config.embeddingModel ? 'ollama' : undefined));
  const model = resolveEmbeddingModel(config.embeddingModel);
  const fallbackChain = resolveEmbeddingFallbackChain(config.embeddingFallbackChain);
  const options = { url: config.embeddingUrl, dimensions: config.embeddingDimensions, fallbackChain };
  const chain = [provider, ...fallbackChain].filter((item, index, all) =>
    item !== 'none' && all.indexOf(item) === index
  );
  if (chain.length > 1 && chain.includes('gemini')) {
    const singleOptions = { url: config.embeddingUrl, dimensions: config.embeddingDimensions };
    return new FallbackEmbeddings(chain.map((item) => item === 'gemini'
      ? new GeminiEmbeddings({ model })
      : createEmbeddingProvider(item, model, singleOptions)));
  }
  if (provider === 'gemini' && fallbackChain.length === 0) return new GeminiEmbeddings({ model });
  return createEmbeddingProvider(provider, model, options);
}
export function createVectorStore(config: VectorStoreConfig = {}): VectorStoreAdapter {
  const type = (clean(config.type) || clean(process.env.ORACLE_VECTOR_DB) || 'lancedb').toLowerCase() as VectorDBType;
  const collectionName = clean(config.collectionName) || COLLECTION_NAME;
  switch (type) {
    case 'sqlite-vec': {
      const dbPath = tenantDataPath(clean(config.dataPath) || clean(process.env.ORACLE_VECTOR_DB_PATH) || VECTORS_DB_PATH);
      const embedder = createConfiguredEmbedder(config);
      return guardVectorStore(new SqliteVecAdapter(collectionName, dbPath, embedder), type, collectionName, embedder, dbPath, config.embeddingModel);
    }
    case 'lancedb': {
      const dbPath = tenantDataPath(clean(config.dataPath) || clean(process.env.ORACLE_VECTOR_DB_PATH) || LANCEDB_DIR);
      const embedder = createConfiguredEmbedder(config);
      return guardVectorStore(new LanceDBAdapter(collectionName, dbPath, embedder), type, collectionName, embedder, dbPath, config.embeddingModel);
    }
    case 'qdrant': {
      const embedder = createConfiguredEmbedder(config);
      return guardVectorStore(new QdrantAdapter(collectionName, embedder, {
        url: clean(config.qdrantUrl) || clean(process.env.QDRANT_URL),
        apiKey: clean(config.qdrantApiKey) || clean(process.env.QDRANT_API_KEY),
      }), type, collectionName, embedder, clean(config.qdrantUrl) || clean(process.env.QDRANT_URL), config.embeddingModel);
    }
    case 'cloudflare-vectorize': {
      return createCloudflareVectorStore(collectionName, config);
    }
    case 'proxy': {
      const contract = requireVectorProxyContract({
        endpoint: config.proxyEndpoint,
        collectionName,
        backend: config.type,
      });
      return new ProxyVectorAdapter(collectionName, contract.baseUrl, contract.timeoutMs);
    }
    case 'turbovec': {
      return new TurboVecAdapter(collectionName, clean(config.proxyEndpoint));
    }
    case 'chroma':
    default: {
      const dataPath = tenantDataPath(clean(config.dataPath) || CHROMADB_DIR);
      const pythonVersion = clean(config.pythonVersion) || '3.12';
      return new ChromaMcpAdapter(collectionName, dataPath, pythonVersion);
    }
  }
}
function guardVectorStore<T extends VectorStoreAdapter>(
  store: T, adapterName: VectorDBType, collectionName: string, embedder: EmbeddingProvider,
  storagePath?: string, modelName?: string,
): T {
  return withEmbedderIdentityGuard(store, {
    adapterName,
    collectionName,
    embedder,
    modelName: resolveEmbeddingModel(modelName),
    storagePath,
  });
}
function loadActiveVectorConfig(): ReturnType<typeof loadVectorConfig> {
  const dataDir = process.env.ORACLE_DATA_DIR;
  return loadVectorConfig(dataDir ? configPath(dataDir) : configPath());
}
export function getEmbeddingModels(
  cfg: ReturnType<typeof loadVectorConfig> = loadActiveVectorConfig(),
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
  return {
    nomic: { collection: COLLECTION_NAME, model: 'nomic-embed-text', adapter: 'lancedb', dataPath: LANCEDB_DIR },
    qwen3: { collection: 'oracle_knowledge_qwen3', model: 'qwen3-embedding', adapter: 'lancedb', dataPath: LANCEDB_DIR },
    'bge-m3': { collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', adapter: 'lancedb', dataPath: LANCEDB_DIR },
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
function resolveModelKey(model: string | undefined, models: Record<string, EmbeddingModelConfig>): string {
  const key = model && models[model] ? model : (models['bge-m3'] ? 'bge-m3' : Object.keys(models)[0]);
  if (!key) throw new Error('No embedding models configured');
  return key;
}
export function createVectorStoreForModel(preset: EmbeddingModelConfig): VectorStoreAdapter {
  return createVectorStore(vectorStoreConfigFromPreset(preset));
}
function vectorStoreConfigFromPreset(preset: EmbeddingModelConfig): VectorStoreConfig {
  return {
    type: preset.adapter || 'lancedb',
    collectionName: preset.collection,
    embeddingProvider: resolveEmbeddingProviderType(
      (preset.provider as EmbeddingProviderType | undefined) ?? preset.embedder?.backend,
    ),
    embeddingModel: preset.embedder?.model || preset.model,
    embeddingUrl: preset.embedder?.url,
    embeddingDimensions: preset.embedder?.dimensions,
    embeddingFallbackChain: preset.embedder?.fallbackChain
      ?? (preset.embedder?.fallback ? [preset.embedder.fallback] : undefined),
    proxyEndpoint: preset.endpoint,
    ...(preset.dataPath && { dataPath: preset.dataPath }),
    ...(preset.pythonVersion && { pythonVersion: preset.pythonVersion }),
    ...(preset.qdrantUrl && { qdrantUrl: preset.qdrantUrl }),
    ...(preset.qdrantApiKey && { qdrantApiKey: preset.qdrantApiKey }),
    ...(preset.cfAccountId && { cfAccountId: preset.cfAccountId }),
    ...(preset.cfApiToken && { cfApiToken: preset.cfApiToken }),
  };
}
export function getVectorStoreConfigByModel(
  model?: string,
  models = getEmbeddingModels(),
): VectorStoreConfig {
  const key = resolveModelKey(model, models);
  return vectorStoreConfigFromPreset(models[key]);
}
export function getVectorStoreByModel(
  model?: string,
  models = getEmbeddingModels(),
  connectStore: (store: VectorStoreAdapter) => Promise<void> = (store) => store.connect(),
): VectorStoreAdapter {
  const key = resolveModelKey(model, models);
  let store = modelStoreCache.get(key);
  if (!store) {
    const preset = models[key];
    store = createVectorStoreForModel(preset);
    modelStoreCache.set(key, store);
    const newStore = store;
    connectPromises.set(key, Promise.resolve().then(() => connectStore(newStore)).catch(e =>
      console.warn(`[VectorRegistry] Failed to connect ${key}:`, e instanceof Error ? e.message : String(e))
    ));
  }
  return store;
}
export async function ensureVectorStoreConnected(
  model?: string,
  models = getEmbeddingModels(),
): Promise<VectorStoreAdapter> {
  const key = resolveModelKey(model, models);
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
export async function reloadCachedVectorStores(
  models = getEmbeddingModels(),
  connectStore: (store: VectorStoreAdapter) => Promise<void> = (store) => store.connect(),
): Promise<{ reloaded: number }> {
  const keys = [...modelStoreCache.keys()];
  await closeCachedVectorStores();
  const reloadKeys = keys.filter((key) => key in models);
  await Promise.all(reloadKeys.map(async (key) => {
    const store = getVectorStoreByModel(key, models, connectStore);
    const pending = connectPromises.get(key);
    if (pending) await pending;
    return store;
  }));
  return { reloaded: reloadKeys.length };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
