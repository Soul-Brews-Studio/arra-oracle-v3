/**
 * Qdrant Adapter
 *
 * Cloud-native vector DB with filtering, payload indexing, and snapshots.
 * Uses EmbeddingProvider since Qdrant stores pre-computed vectors.
 */

import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider } from '../types.ts';

export class QdrantAdapter implements VectorStoreAdapter {
  readonly name = 'qdrant';
  private client: any = null;
  private collectionName: string;
  private url: string;
  private apiKey?: string;
  private embedder: EmbeddingProvider;

  constructor(
    collectionName: string,
    embedder: EmbeddingProvider,
    config: { url?: string; apiKey?: string } = {}
  ) {
    this.collectionName = collectionName;
    this.embedder = embedder;
    this.url = config.url || process.env.QDRANT_URL || 'http://localhost:6333';
    this.apiKey = config.apiKey || process.env.QDRANT_API_KEY;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const { QdrantClient } = await import('@qdrant/js-client-rest');
    this.client = new QdrantClient({
      url: this.url,
      ...(this.apiKey && { apiKey: this.apiKey }),
    });

    console.log(`[Qdrant] Connected at ${this.url}`);
  }

  async close(): Promise<void> {
    this.client = null;
    console.log('[Qdrant] Closed');
  }

  async ensureCollection(): Promise<void> {
    if (!this.client) throw new Error('Qdrant not connected');

    try {
      await this.client.getCollection(this.collectionName);
    } catch {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.embedder.dimensions,
          distance: 'Cosine',
        },
      });
    }

    console.log(`[Qdrant] Collection '${this.collectionName}' ready (${this.embedder.dimensions} dims)`);
  }

  async deleteCollection(): Promise<void> {
    if (!this.client) throw new Error('Qdrant not connected');

    try {
      await this.client.deleteCollection(this.collectionName);
      console.log(`[Qdrant] Collection '${this.collectionName}' deleted`);
    } catch (e) {
      console.warn('[Qdrant] deleteCollection failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    if (!this.client) throw new Error('Qdrant not connected');

    const texts = docs.map(d => d.document);
    const embeddings = await this.embedder.embed(texts, 'passage');

    const points = docs.map((doc, i) => ({
      id: this.hashId(doc.id),
      vector: embeddings[i],
      payload: {
        _id: doc.id,
        document: doc.document,
        ...doc.metadata,
      },
    }));

    await this.client.upsert(this.collectionName, { points });
    console.log(`[Qdrant] Added ${docs.length} documents`);
  }

  async query(text: string, limit: number = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    if (!this.client) throw new Error('Qdrant not connected');

    const [queryEmbedding] = await this.embedder.embed([text], 'query');

    const filter = where ? {
      must: Object.entries(where).map(([key, value]) => ({
        key,
        match: { value },
      })),
    } : undefined;

    const results = await this.client.search(this.collectionName, {
      vector: queryEmbedding,
      limit,
      with_payload: true,
      ...(filter && { filter }),
    });

    return {
      ids: results.map((r: any) => r.payload._id || String(r.id)),
      documents: results.map((r: any) => r.payload.document || ''),
      distances: results.map((r: any) => 1 - (r.score ?? 0)), // Cosine similarity → distance
      metadatas: results.map((r: any) => {
        const { _id, document, ...meta } = r.payload;
        return meta;
      }),
    };
  }

  async queryById(id: string, nResults: number = 5): Promise<VectorQueryResult> {
    if (!this.client) throw new Error('Qdrant not connected');

    const numericId = this.hashId(id);

    // Get the point's vector (retrieve replaces getPoints in newer client versions)
    const points = await this.client.retrieve(this.collectionName, {
      ids: [numericId],
      with_vector: true,
    });

    if (points.length === 0) {
      throw new Error(`No embedding found for document: ${id}`);
    }

    const vector = points[0].vector;
    const results = await this.client.search(this.collectionName, {
      vector,
      limit: nResults + 1,
      with_payload: true,
    });

    const filtered = results
      .filter((r: any) => (r.payload._id || String(r.id)) !== id)
      .slice(0, nResults);

    return {
      ids: filtered.map((r: any) => r.payload._id || String(r.id)),
      documents: filtered.map((r: any) => r.payload.document || ''),
      distances: filtered.map((r: any) => 1 - (r.score ?? 0)),
      metadatas: filtered.map((r: any) => {
        const { _id, document, ...meta } = r.payload;
        return meta;
      }),
    };
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.client) return { count: 0 };
    try {
      const info = await this.client.getCollection(this.collectionName);
      return { count: info.points_count ?? 0 };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    const stats = await this.getStats();
    return { count: stats.count, name: this.collectionName };
  }

  /**
   * Convert string ID to numeric hash for Qdrant (requires integer or UUID IDs).
   * Uses FNV-1a hash for deterministic mapping.
   */
  private hashId(id: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0; // Ensure positive 32-bit integer
  }
}
