import type { UnifiedProxyManifest } from '../plugins/unified-manifest.ts';
import type { EmbedderConfig, VectorDBType } from './types.ts';

export type LocalVectorEngine = 'lancedb' | 'qdrant' | 'sqlite-vec';
export type VectorProxyManifest = UnifiedProxyManifest;

export interface VectorStorageService {
  type: 'builtin' | 'proxy';
  endpoint?: string;
  capabilities?: Record<string, unknown>;
}

export interface VectorStorageConfig {
  default: string;
  services: Record<string, VectorStorageService>;
}

export interface VectorServerV2Storage { storage: VectorStorageConfig }

export interface VectorCollectionConfig {
  collection: string;
  model: string;
  provider: string;
  adapter?: VectorDBType;
  dataPath?: string;
  pythonVersion?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
  service?: string;
  endpoint?: string;
  enabled?: boolean;
  primary?: boolean;
  embedder?: EmbedderConfig;
}

export interface VectorConfigUpdateCollection {
  collection?: string;
  model?: string;
  provider?: string;
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
  vectorProxyUrl?: string;
  collections?: Record<string, VectorConfigUpdateCollection>;
}

export interface VectorServerConfig {
  version: '1' | '1.0' | '2' | '2.0' | 'legacy';
  enabled?: boolean;
  host: string;
  port: number;
  vectorProxyUrl?: string;
  collections: Record<string, VectorCollectionConfig>;
  dataPath: string;
  embedder?: EmbedderConfig;
  embeddingEndpoint: string;
  storage?: VectorStorageConfig;
  proxy?: VectorProxyManifest[];
}

export interface VectorModelRegistryEntry {
  collection: string;
  model: string;
  adapter?: VectorDBType;
  dataPath?: string;
  embedder?: EmbedderConfig;
  provider?: string;
  service?: string;
  endpoint?: string;
  pythonVersion?: string;
  qdrantUrl?: string;
  qdrantApiKey?: string;
}
