import type { EmbeddingProvider, VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../types.ts';

type D1Value = string | number | null;
type D1Result<T> = { results?: T[] };
type VectorMetadata = Record<string, string | number | boolean>;

export interface CloudflareD1Statement {
  bind(...values: D1Value[]): CloudflareD1Statement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

export interface CloudflareD1Database {
  prepare(sql: string): CloudflareD1Statement;
  batch(statements: CloudflareD1Statement[]): Promise<unknown[]>;
}

export interface CloudflareAIWorkerBinding {
  run(model: string, input: { text: string[] }): Promise<{ data?: number[][]; result?: { data?: number[][] } }>;
}

export interface CloudflareVectorizeBinding {
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: VectorMetadata }>): Promise<unknown>;
  query(vector: number[], options?: Record<string, unknown>): Promise<unknown>;
  queryById?(id: string, options?: Record<string, unknown>): Promise<unknown>;
  getByIds?(ids: string[]): Promise<unknown>;
  deleteByIds?(ids: string[]): Promise<unknown>;
}

interface D1VectorRow { id: string; document: string; metadata: string }
interface VectorizeMatch { id: string; score?: number; metadata?: Record<string, unknown> }

const CF_MODEL = '@cf/baai/bge-m3';
const CF_DIMENSIONS = 1024;
const TABLE = 'oracle_vector_documents';

export class CloudflareWorkerAIEmbeddings implements EmbeddingProvider {
  readonly name = 'cloudflare-ai';
  readonly dimensions = CF_DIMENSIONS;
  private model: string;

  constructor(private ai: CloudflareAIWorkerBinding, config: { model?: string } = {}) {
    this.model = config.model || CF_MODEL;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const response = await this.ai.run(this.model, { text: texts.map((text) => text.slice(0, 3000)) });
    const data = response.data ?? response.result?.data;
    if (!Array.isArray(data) || data.length !== texts.length) throw new Error('Cloudflare Workers AI returned invalid embeddings');
    for (const vector of data) assertVector(vector);
    return data;
  }
}

export class CloudflareVectorizeD1Adapter implements VectorStoreAdapter {
  readonly name = 'cloudflare-vectorize';
  private table: string;

  constructor(
    private collectionName: string,
    private embedder: EmbeddingProvider,
    private bindings: { vectorize: CloudflareVectorizeBinding; d1: CloudflareD1Database },
    config: { tableName?: string } = {},
  ) {
    this.table = quoteIdentifier(config.tableName || TABLE);
  }

  async connect(): Promise<void> { await this.ensureCollection(); }
  async close(): Promise<void> {}

  async ensureCollection(): Promise<void> {
    try {
      await this.bindings.d1.prepare(`SELECT COUNT(*) AS count FROM ${this.table} WHERE collection = ?`)
        .bind(this.collectionName).first();
    } catch (error) {
      throw new Error(`Cloudflare D1 vector table ${this.table} is unavailable; run the Workers D1 migration first: ${message(error)}`);
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (!docs.length) return;
    await this.bindings.vectorize.upsert(await this.vectorsFor(docs));
    await this.writeRows(docs);
  }

  async replaceDocuments(docs: VectorDocument[]): Promise<void> {
    await this.deleteCollection();
    await this.addDocuments(docs);
  }

  async deleteCollection(): Promise<void> {
    const ids = (await this.rowsForCollection()).map((row) => row.id);
    for (let i = 0; i < ids.length; i += 100) await this.bindings.vectorize.deleteByIds?.(ids.slice(i, i + 100));
    await this.bindings.d1.prepare(`DELETE FROM ${this.table} WHERE collection = ?`).bind(this.collectionName).run();
  }

  async query(text: string, limit = 10, where?: Record<string, unknown>): Promise<VectorQueryResult> {
    const [vector] = await this.embedder.embed([text], 'query');
    const response = await this.bindings.vectorize.query(vector, {
      topK: topK(limit),
      returnValues: false,
      returnMetadata: 'all',
      ...(where && { filter: eqFilter(where) }),
    });
    return this.hydrate(matches(response));
  }

  async queryById(id: string, nResults = 5): Promise<VectorQueryResult> {
    const options = { topK: topK(nResults + 1), returnValues: false, returnMetadata: 'all' };
    const response = this.bindings.vectorize.queryById
      ? await this.bindings.vectorize.queryById(id, options)
      : await this.queryByStoredVector(id, options);
    return this.hydrate(matches(response).filter((match) => match.id !== id).slice(0, topK(nResults)));
  }

  async getStats(): Promise<{ count: number }> {
    const row = await this.bindings.d1.prepare(`SELECT COUNT(*) AS count FROM ${this.table} WHERE collection = ?`)
      .bind(this.collectionName).first<{ count: number }>();
    return { count: nonNegative(row?.count) };
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    return { ...(await this.getStats()), name: this.collectionName };
  }

  private async queryByStoredVector(id: string, options: Record<string, unknown>): Promise<unknown> {
    const found = await this.bindings.vectorize.getByIds?.([id]);
    const record = vectors(found)[0];
    if (!record?.values) throw new Error(`No embedding found for document: ${id}`);
    return this.bindings.vectorize.query(record.values, options);
  }

  private async vectorsFor(docs: VectorDocument[]) {
    const missing = docs.filter((doc) => !doc.vector);
    const embedded = missing.length ? await this.embedder.embed(missing.map((doc) => doc.document), 'passage') : [];
    if (embedded.length !== missing.length) throw new Error(`Cloudflare embedder returned ${embedded.length} vectors for ${missing.length} documents`);
    let offset = 0;
    return docs.map((doc) => {
      const values = doc.vector ?? embedded[offset++];
      assertVector(values);
      return { id: doc.id, values, metadata: { ...doc.metadata, collection: this.collectionName } };
    });
  }

  private async writeRows(docs: VectorDocument[]): Promise<void> {
    const sql = `INSERT INTO ${this.table} (collection,id,document,metadata,updated_at) VALUES (?,?,?,?,?) `
      + 'ON CONFLICT(collection,id) DO UPDATE SET document=excluded.document, metadata=excluded.metadata, updated_at=excluded.updated_at';
    const now = new Date().toISOString();
    const statements = docs.map((doc) => this.bindings.d1.prepare(sql)
      .bind(this.collectionName, doc.id, doc.document, JSON.stringify(doc.metadata), now));
    for (let i = 0; i < statements.length; i += 50) await this.bindings.d1.batch(statements.slice(i, i + 50));
  }

  private async rowsFor(ids: string[]): Promise<Map<string, D1VectorRow>> {
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(',');
    const result = await this.bindings.d1.prepare(
      `SELECT id, document, metadata FROM ${this.table} WHERE collection = ? AND id IN (${placeholders})`,
    ).bind(this.collectionName, ...ids).all<D1VectorRow>();
    return new Map((result.results ?? []).map((row) => [row.id, row]));
  }

  private async rowsForCollection(): Promise<D1VectorRow[]> {
    const result = await this.bindings.d1.prepare(`SELECT id, document, metadata FROM ${this.table} WHERE collection = ?`)
      .bind(this.collectionName).all<D1VectorRow>();
    return result.results ?? [];
  }

  private async hydrate(found: VectorizeMatch[]): Promise<VectorQueryResult> {
    const rows = await this.rowsFor(found.map((match) => match.id));
    return {
      ids: found.map((match) => match.id),
      documents: found.map((match) => rows.get(match.id)?.document ?? String(match.metadata?.document ?? '')),
      distances: found.map((match) => 1 - nonNegative(match.score)),
      metadatas: found.map((match) => parseMetadata(rows.get(match.id)?.metadata, match.metadata)),
    };
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid D1 vector table name: ${value}`);
  return `"${value}"`;
}

function topK(value: number): number {
  return Math.max(1, Math.min(50, Number.isFinite(value) ? Math.trunc(value) : 10));
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function eqFilter(where: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(where).map(([key, value]) => [key, { $eq: value }]));
}

function matches(value: unknown): VectorizeMatch[] {
  const record = value as { matches?: VectorizeMatch[]; result?: { matches?: VectorizeMatch[] } };
  return Array.isArray(record?.matches) ? record.matches : Array.isArray(record?.result?.matches) ? record.result.matches : [];
}

function vectors(value: unknown): Array<{ values?: number[] }> {
  const record = value as { vectors?: Array<{ values?: number[] }>; result?: Array<{ values?: number[] }> };
  if (Array.isArray(value)) return value as Array<{ values?: number[] }>;
  return Array.isArray(record?.vectors) ? record.vectors : Array.isArray(record?.result) ? record.result : [];
}

function parseMetadata(raw: string | undefined, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : stripDocument(fallback); }
  catch { return stripDocument(fallback); }
}

function stripDocument(value: Record<string, unknown>): Record<string, unknown> {
  const { document, ...rest } = value;
  return rest;
}

function assertVector(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('Cloudflare vector must be a non-empty finite number array');
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
