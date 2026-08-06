export type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from './adapter.ts';

export type EmbedType = 'query' | 'passage';

/**
 * Embedding provider interface.
 * Separated from storage because ChromaDB handles embeddings internally,
 * while sqlite-vec/Qdrant/LanceDB need external embeddings.
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[], type?: EmbedType): Promise<number[][]>;
}

export type EmbedderBackend = 'none' | 'local' | 'remote' | 'ollama' | 'openai' | 'gemini' | 'cloudflare-ai';

export interface EmbedderConfig {
  backend?: EmbeddingProviderType;
  url?: string;
  model?: string;
  dimensions?: number;
  fallbackChain?: EmbeddingProviderType[];
  default?: EmbeddingProviderType;
  fallback?: EmbeddingProviderType;
  fallbackModel?: string;
}

export type VectorDBType =
  | 'chroma'
  | 'sqlite-vec'
  | 'lancedb'
  | 'qdrant'
  | 'cloudflare-vectorize'
  | 'proxy'
  | 'turbovec';
export type EmbeddingProviderType =
  | 'none'
  | 'local'
  | 'remote'
  | 'chromadb-internal'
  | 'ollama'
  | 'openai'
  | 'gemini'
  | 'cloudflare-ai';
