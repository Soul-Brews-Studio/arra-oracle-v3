/**
 * Cloudflare Vectorize Adapter
 *
 * Uses Cloudflare Workers AI for embeddings + Vectorize for vector storage.
 * Ported from laris-co/webhook-relay src/vectorize.ts pattern.
 *
 * Two modes:
 * 1. **Worker mode**: Direct binding (env.VECTORIZE + env.AI) — zero latency
 * 2. **Remote mode**: Cloudflare REST API — works from any runtime (Node, Bun, CLI)
 *
 * Model: @cf/baai/bge-m3 (multilingual, 1024 dimensions)
 */

import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider, EmbedType } from '../types.ts';

const CF_MODEL = '@cf/baai/bge-m3';
const CF_DIMENSIONS = 1024;
const BATCH_SIZE = 20; // Thai text uses 2-3x tokens, keep under 60K limit

/**
 * Cloudflare Workers AI Embedding Provider
 * Works via REST API from any runtime.
 */
export class CloudflareAIEmbeddings implements EmbeddingProvider {
  readonly name = 'cloudflare-ai';
  readonly dimensions = CF_DIMENSIONS;
  private accountId: string;
  private apiToken: string;
  private model: string;

  constructor(config: { accountId?: string; apiToken?: string; model?: string } = {}) {
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN || '';
    this.model = config.model || process.env.ORACLE_EMBEDDING_MODEL || CF_MODEL;

    if (!this.accountId || !this.apiToken) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required for Cloudflare AI embeddings');
    }
  }

  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    if (!texts.length) return [];

    const allEmbeddings: number[][] = [];

    // Batch to stay under token limits
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      // Truncate each text to ~3000 chars (safe for Thai)
      const truncated = batch.map(t => t.length > 3000 ? t.slice(0, 3000) : t);

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: truncated }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cloudflare AI error: ${error}`);
      }

      const data = await response.json() as {
        result: { shape: number[]; data: number[][] };
        success: boolean;
      };

      if (!data.success || !data.result?.data) {
        throw new Error('Cloudflare AI returned no embeddings');
      }

      allEmbeddings.push(...data.result.data);
    }

    return allEmbeddings;
  }
}

/**
 * Cloudflare Vectorize Adapter (Remote API mode)
 *
 * Uses Cloudflare REST API to interact with Vectorize indexes.
 * Works from Bun, Node, or any runtime — not just CF Workers.
 */
export class CloudflareVectorizeAdapter implements VectorStoreAdapter {
  readonly name = 'cloudflare-vectorize';
  private accountId: string;
  private apiToken: string;
  private indexName: string;
  private embedder: EmbeddingProvider;

  constructor(
    indexName: string,
    embedder: EmbeddingProvider,
    config: { accountId?: string; apiToken?: string } = {}
  ) {
    this.indexName = indexName;
    this.embedder = embedder;
    this.accountId = config.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = config.apiToken || process.env.CLOUDFLARE_API_TOKEN || '';

    if (!this.accountId || !this.apiToken) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required');
    }
  }

  private async cfApi(path: string, method: string = 'GET', body?: any): Promise<any> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vectorize API error (${response.status}): ${error}`);
    }

    return await response.json();
  }

  async connect(): Promise<void> {
    // Verify the index exists
    try {
      await this.cfApi('');
      console.log(`[CF Vectorize] Connected to index '${this.indexName}'`);
    } catch (e) {
      throw new Error(`Failed to connect to Vectorize index '${this.indexName}': ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async close(): Promise<void> {
    // No persistent connection to close for REST API
    console.log('[CF Vectorize] Closed');
  }

  async ensureCollection(): Promise<void> {
    // In Vectorize, indexes are created via wrangler/dashboard, not runtime.
    // Just verify it exists.
    try {
      await this.cfApi('');
    } catch {
      // Try to create the index
      const createUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes`;
      const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: this.indexName,
          config: {
            dimensions: this.embedder.dimensions,
            metric: 'cosine',
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create Vectorize index: ${error}`);
      }

      console.log(`[CF Vectorize] Created index '${this.indexName}' (${this.embedder.dimensions} dims)`);
    }
  }

  async deleteCollection(): Promise<void> {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}`;
      await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });
      console.log(`[CF Vectorize] Deleted index '${this.indexName}'`);
    } catch (e) {
      console.warn('[CF Vectorize] deleteCollection failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;

    const texts = docs.map(d => d.document);
    const embeddings = await this.embedder.embed(texts, 'passage');

    // Vectorize upsert in batches (max 1000 per call)
    const UPSERT_BATCH = 1000;
    for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
      const batchDocs = docs.slice(i, i + UPSERT_BATCH);
      const vectors = batchDocs.map((doc, j) => ({
        id: doc.id,
        values: embeddings[i + j],
        metadata: doc.metadata,
      }));

      // Vectorize uses NDJSON for vector upsert
      const ndjson = vectors.map(v => JSON.stringify(v)).join('\n');
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/upsert`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/x-ndjson',
        },
        body: ndjson,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vectorize upsert failed: ${error}`);
      }
    }

    console.log(`[CF Vectorize] Added ${docs.length} documents`);
  }

  async query(text: string, limit: number = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    const [queryEmbedding] = await this.embedder.embed([text], 'query');

    const body: any = {
      vector: queryEmbedding,
      topK: limit,
      returnValues: false,
      returnMetadata: 'all',
    };

    if (where) {
      // Vectorize filter format: { field: { $eq: value } }
      body.filter = Object.fromEntries(
        Object.entries(where).map(([k, v]) => [k, { $eq: v }])
      );
    }

    const data = await this.cfApi('/query', 'POST', body);
    const matches = data.result?.matches || [];

    return {
      ids: matches.map((m: any) => m.id),
      documents: matches.map((m: any) => m.metadata?.document || ''),
      distances: matches.map((m: any) => 1 - (m.score ?? 0)), // Cosine similarity → distance
      metadatas: matches.map((m: any) => {
        const { document, ...meta } = m.metadata || {};
        return meta;
      }),
    };
  }

  async queryById(id: string, nResults: number = 5): Promise<VectorQueryResult> {
    // Get the vector first
    const getUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/vectorize/v2/indexes/${this.indexName}/getByIds`;
    const getResponse = await fetch(getUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [id] }),
    });

    if (!getResponse.ok) {
      throw new Error(`Failed to get vector: ${await getResponse.text()}`);
    }

    const getData = await getResponse.json() as any;
    const vectors = getData.result || [];
    if (vectors.length === 0 || !vectors[0].values) {
      throw new Error(`No embedding found for document: ${id}`);
    }

    // Query using the vector
    const body = {
      vector: vectors[0].values,
      topK: nResults + 1,
      returnValues: false,
      returnMetadata: 'all',
    };

    const data = await this.cfApi('/query', 'POST', body);
    const matches = (data.result?.matches || [])
      .filter((m: any) => m.id !== id)
      .slice(0, nResults);

    return {
      ids: matches.map((m: any) => m.id),
      documents: matches.map((m: any) => m.metadata?.document || ''),
      distances: matches.map((m: any) => 1 - (m.score ?? 0)),
      metadatas: matches.map((m: any) => {
        const { document, ...meta } = m.metadata || {};
        return meta;
      }),
    };
  }

  async getStats(): Promise<{ count: number }> {
    try {
      const data = await this.cfApi('');
      return { count: data.result?.vectorsCount ?? 0 };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    const stats = await this.getStats();
    return { count: stats.count, name: this.indexName };
  }

  // Note: Vectorize doesn't expose raw vectors via query — only via getByIds.
  // getAllEmbeddings is not efficiently supported.
}
