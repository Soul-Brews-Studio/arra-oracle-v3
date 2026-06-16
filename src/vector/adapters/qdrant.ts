/**
 * Qdrant Adapter
 *
 * Cloud-native vector DB with filtering, payload indexing, and snapshots.
 * Uses EmbeddingProvider since Qdrant stores pre-computed vectors.
 */

import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider } from '../types.ts';
import { createHash } from 'node:crypto';

export function qdrantPointId(id: string): string {
  const hex = createHash('sha256').update(id).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

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
    this.url = clean(config.url) || clean(process.env.QDRANT_URL) || 'http://localhost:6333';
    this.apiKey = clean(config.apiKey) || clean(process.env.QDRANT_API_KEY);
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

    const needEmbed: number[] = [];
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i].vector) needEmbed.push(i);
    }

    let fresh: number[][] = [];
    if (needEmbed.length > 0) {
      fresh = await this.embedder.embed(needEmbed.map(i => docs[i].document), 'passage');
      assertEmbeddingCount('Qdrant', fresh.length, needEmbed.length);
    }
    let freshIdx = 0;

    const points = docs.map((doc, i) => ({
      id: this.pointId(doc.id),
      vector: doc.vector ?? fresh[freshIdx++],
      payload: {
        _id: doc.id,
        document: doc.document,
        ...doc.metadata,
      },
    }));

    await this.client.upsert(this.collectionName, { points });
    const reused = docs.length - needEmbed.length;
    if (reused > 0) {
      console.log(`[Qdrant] Added ${docs.length} documents (${reused} with precomputed vectors)`);
    } else {
      console.log(`[Qdrant] Added ${docs.length} documents`);
    }
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

    const pointId = this.pointId(id);

    // Get the point's vector (retrieve replaces getPoints in newer client versions)
    const points = await this.client.retrieve(this.collectionName, {
      ids: [pointId],
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
   * Convert arbitrary document IDs to stable UUID-shaped point IDs.
   * Qdrant accepts UUID strings; SHA-256 avoids the old 32-bit FNV collision
   * space while keeping deterministic lookup for queryById().
   */
  private pointId(id: string): string {
    return qdrantPointId(id);
  }
}

function assertEmbeddingCount(adapter: string, actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`${adapter} embedder returned ${actual} vectors for ${expected} documents`);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
