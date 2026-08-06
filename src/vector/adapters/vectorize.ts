import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../adapter.ts';
import type { EmbeddingProvider } from '../types.ts';
import type { CloudflareVectorizeBinding } from './cloudflare-worker.ts';

type VectorizeMatch = { id: string; score?: number; metadata?: Record<string, unknown> };
type StoredVector = { id?: string; values?: number[]; metadata?: Record<string, unknown> };
type VectorizeIndex = CloudflareVectorizeBinding & {
  describe?: () => Promise<{ vectorsCount?: number; count?: number }>;
  listVectors?: (options?: { count?: number; cursor?: string; namespace?: string }) => Promise<{
    ids?: string[];
    vectors?: Array<{ id: string }>;
    cursor?: string;
  }>;
};

export interface VectorizeAdapterOptions {
  namespace?: string;
}

export class VectorizeAdapter implements VectorStoreAdapter {
  readonly name = 'cloudflare-vectorize';
  private namespace: string;

  constructor(
    private collectionName: string,
    private embedder: EmbeddingProvider,
    private vectorize: VectorizeIndex,
    options: VectorizeAdapterOptions = {},
  ) {
    this.namespace = options.namespace ?? collectionName;
  }

  async connect(): Promise<void> { await this.ensureCollection(); }
  async close(): Promise<void> {}

  async ensureCollection(): Promise<void> {
    if (this.vectorize.describe) await this.vectorize.describe();
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (!docs.length) return;
    await this.vectorize.upsert(await this.vectorsFor(docs));
  }

  async replaceDocuments(docs: VectorDocument[]): Promise<void> {
    await this.deleteCollection();
    await this.addDocuments(docs);
  }

  async deleteCollection(): Promise<void> {
    if (!this.vectorize.deleteByIds || !this.vectorize.listVectors) {
      throw new Error('VectorizeAdapter.deleteCollection requires listVectors and deleteByIds bindings');
    }
    const ids = await this.listIds();
    for (let i = 0; i < ids.length; i += 100) await this.vectorize.deleteByIds(ids.slice(i, i + 100));
  }

  async query(text: string, limit = 10, where?: Record<string, unknown>): Promise<VectorQueryResult> {
    const [vector] = await this.embedder.embed([text], 'query');
    const response = await this.vectorize.query(vector, this.queryOptions(limit, where));
    return fromMatches(matches(response));
  }

  async queryById(id: string, nResults = 5): Promise<VectorQueryResult> {
    const options = this.queryOptions(nResults + 1);
    const response = this.vectorize.queryById
      ? await this.vectorize.queryById(id, options)
      : await this.queryByStoredVector(id, options);
    return fromMatches(matches(response).filter((match) => match.id !== id).slice(0, topK(nResults)));
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.vectorize.describe) return { count: 0 };
    try {
      const info = await this.vectorize.describe();
      return { count: nonNegative(info.vectorsCount ?? info.count) };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    return { ...(await this.getStats()), name: this.collectionName };
  }

  private async vectorsFor(docs: VectorDocument[]) {
    const missing = docs.filter((doc) => !doc.vector);
    const embedded = missing.length ? await this.embedder.embed(missing.map((doc) => doc.document), 'passage') : [];
    if (embedded.length !== missing.length) throw new Error(`Vectorize embedder returned ${embedded.length} vectors for ${missing.length} documents`);
    let offset = 0;
    return docs.map((doc) => {
      const values = doc.vector ?? embedded[offset++];
      assertVector(values);
      return {
        id: doc.id,
        values,
        namespace: this.namespace,
        metadata: { ...doc.metadata, collection: this.collectionName, document: doc.document },
      };
    });
  }

  private queryOptions(limit: number, where?: Record<string, unknown>): Record<string, unknown> {
    return {
      topK: topK(limit),
      returnValues: false,
      returnMetadata: 'all',
      namespace: this.namespace,
      ...(where && Object.keys(where).length ? { filter: eqFilter(where) } : {}),
    };
  }

  private async queryByStoredVector(id: string, options: Record<string, unknown>): Promise<unknown> {
    const record = storedVectors(await this.vectorize.getByIds?.([id]))[0];
    if (!record?.values) throw new Error(`No embedding found for document: ${id}`);
    return this.vectorize.query(record.values, options);
  }

  private async listIds(): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.vectorize.listVectors?.({ count: 1000, cursor, namespace: this.namespace });
      ids.push(...(page?.ids ?? page?.vectors?.map((vector) => vector.id) ?? []));
      cursor = page?.cursor;
    } while (cursor);
    return ids;
  }
}

function topK(value: number): number {
  return Math.max(1, Math.min(50, Number.isFinite(value) ? Math.trunc(value) : 10));
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function eqFilter(where: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(where)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, isFilterOperator(value) ? value : { $eq: value }]));
}

function isFilterOperator(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function matches(value: unknown): VectorizeMatch[] {
  const record = value as { matches?: VectorizeMatch[]; result?: { matches?: VectorizeMatch[] } };
  return Array.isArray(record?.matches) ? record.matches : Array.isArray(record?.result?.matches) ? record.result.matches : [];
}

function storedVectors(value: unknown): StoredVector[] {
  const record = value as { vectors?: StoredVector[]; result?: StoredVector[] };
  if (Array.isArray(value)) return value as StoredVector[];
  return Array.isArray(record?.vectors) ? record.vectors : Array.isArray(record?.result) ? record.result : [];
}

function fromMatches(found: VectorizeMatch[]): VectorQueryResult {
  return {
    ids: found.map((match) => match.id),
    documents: found.map((match) => String(match.metadata?.document ?? '')),
    distances: found.map((match) => 1 - nonNegative(match.score)),
    metadatas: found.map((match) => stripDocument(match.metadata ?? {})),
  };
}

function stripDocument(value: Record<string, unknown>): Record<string, unknown> {
  const { document, ...rest } = value;
  return rest;
}

function assertVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('Vectorize vector must be a non-empty finite number array');
  }
}
