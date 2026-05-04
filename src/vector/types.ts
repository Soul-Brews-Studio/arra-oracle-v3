/**
 * Vector Store Adapter Types
 *
 * Pluggable interface for vector databases.
 * Derived from ChromaMcpClient's public API.
 */

export interface VectorDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
  /**
   * Optional precomputed embedding. When present, adapters MUST use this
   * vector and skip the embedder. Lets a caller (e.g. the indexer worker
   * loop) embed once and route the vector to the storage tier without a
   * second Ollama round-trip.
   *
   * Vector dimension MUST match the collection's column dim or the storage
   * write will fail. Adapters that don't yet honor this field fall back to
   * embedding (the default behavior is preserved — the field is optional).
   */
  vector?: number[];
}

export interface VectorQueryResult {
  ids: string[];
  documents: string[];
  distances: number[];
  metadatas: any[];
}

/**
 * Pluggable vector store interface.
 * Any vector DB (ChromaDB, sqlite-vec, Qdrant, LanceDB) implements this.
 */
export interface VectorStoreAdapter {
  readonly name: string;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureCollection(): Promise<void>;
  deleteCollection(): Promise<void>;
  addDocuments(docs: VectorDocument[]): Promise<void>;
  query(text: string, limit?: number, where?: Record<string, any>): Promise<VectorQueryResult>;
  queryById(id: string, nResults?: number): Promise<VectorQueryResult>;
  getStats(): Promise<{ count: number }>;
  getCollectionInfo(): Promise<{ count: number; name: string }>;
  getAllEmbeddings?(limit?: number): Promise<{ ids: string[]; embeddings: number[][]; metadatas: any[] }>;
}

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

export type VectorDBType = 'chroma' | 'sqlite-vec' | 'lancedb' | 'qdrant' | 'cloudflare-vectorize';
export type EmbeddingProviderType = 'chromadb-internal' | 'ollama' | 'openai' | 'cloudflare-ai';
