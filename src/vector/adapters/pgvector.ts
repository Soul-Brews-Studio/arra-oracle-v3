/**
 * pgvector Adapter
 *
 * Stores embeddings in DO Managed Postgres (fleet-pg / oracle_kb) via the
 * pgvector extension. Mirrors LanceDBAdapter's contract exactly so it is a
 * drop-in replacement (ORACLE_VECTOR_DB=pgvector) — cosine distance, bge-m3
 * 1024d, link key = id, metadata stored as JSONB.
 *
 * Shares the process-wide pool from db/pg.ts with the relational layer (one
 * connection pool for everything — no per-request connect).
 */

import type pg from 'pg';
import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider } from '../types.ts';
import { getPgPool } from '../../db/pg.ts';

/** Format a number[] as a pgvector literal: [0.1,0.2,...] */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export class PgVectorAdapter implements VectorStoreAdapter {
  readonly name = 'pgvector';
  private pool: pg.Pool | null = null;
  private collectionName: string;
  private embedder: EmbeddingProvider;
  private connectionString?: string;
  private caCert?: string;
  private ensured = false;

  constructor(
    collectionName: string,
    embedder: EmbeddingProvider,
    opts: { connectionString?: string; caCert?: string } = {},
  ) {
    // Collection name becomes a SQL identifier — whitelist to prevent injection.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(collectionName)) {
      throw new Error(`[pgvector] invalid collection name: ${collectionName}`);
    }
    this.collectionName = collectionName;
    this.embedder = embedder;
    this.connectionString = opts.connectionString;
    this.caCert = opts.caCert;
  }

  /** Double-quoted, validated identifier for the collection table. */
  private get table(): string {
    return `"${this.collectionName}"`;
  }

  async connect(): Promise<void> {
    if (this.pool) return;
    this.pool = getPgPool({ connectionString: this.connectionString, caCert: this.caCert });
    // Fail fast if the DB is unreachable / misconfigured.
    await this.pool.query('SELECT 1');
    console.error(`[pgvector] Connected (collection '${this.collectionName}')`);
  }

  async close(): Promise<void> {
    // The pool is shared process-wide (relational + every model store). Drop our
    // reference but never end it here — see db/pg.ts closePgPool() for shutdown.
    this.pool = null;
    this.ensured = false;
    console.error('[pgvector] Closed (shared pool left open)');
  }

  private getPool(): pg.Pool {
    if (!this.pool) this.pool = getPgPool({ connectionString: this.connectionString, caCert: this.caCert });
    return this.pool;
  }

  async ensureCollection(): Promise<void> {
    if (this.ensured) return;
    const pool = this.getPool();
    const dims = this.embedder.dimensions;
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id        TEXT PRIMARY KEY,
         document  TEXT,
         metadata  JSONB,
         vector    vector(${dims})
       )`,
    );
    // HNSW + cosine — matches LanceDB's distanceType('cosine').
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "${this.collectionName}_hnsw"
       ON ${this.table} USING hnsw (vector vector_cosine_ops)`,
    );
    this.ensured = true;
    console.error(`[pgvector] Collection '${this.collectionName}' ready (dim ${dims})`);
  }

  async deleteCollection(): Promise<void> {
    const pool = this.getPool();
    await pool.query(`DROP TABLE IF EXISTS ${this.table}`);
    this.ensured = false;
    console.error(`[pgvector] Collection '${this.collectionName}' deleted`);
  }

  /** Embed only docs lacking a precomputed vector (skip the Ollama round-trip otherwise). */
  private async rowsForDocuments(
    docs: VectorDocument[],
  ): Promise<Array<{ id: string; document: string; metadata: string; vector: string }>> {
    const needEmbed: number[] = [];
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i].vector) needEmbed.push(i);
    }
    let fresh: number[][] = [];
    if (needEmbed.length > 0) {
      const texts = needEmbed.map((i) => docs[i].document);
      fresh = await this.embedder.embed(texts, 'passage');
    }
    let freshIdx = 0;
    return docs.map((doc) => ({
      id: doc.id,
      document: doc.document,
      metadata: JSON.stringify(doc.metadata ?? {}),
      vector: toVectorLiteral(doc.vector ?? fresh[freshIdx++]),
    }));
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    await this.ensureCollection();
    const pool = this.getPool();
    const rows = await this.rowsForDocuments(docs);

    // Multi-row upsert in one statement (chunked to stay under param limits).
    const CHUNK = 500;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let off = 0; off < rows.length; off += CHUNK) {
        const slice = rows.slice(off, off + CHUNK);
        const values: any[] = [];
        const tuples = slice.map((r, i) => {
          const b = i * 4;
          values.push(r.id, r.document, r.metadata, r.vector);
          return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, $${b + 4}::vector)`;
        });
        await client.query(
          `INSERT INTO ${this.table} (id, document, metadata, vector)
           VALUES ${tuples.join(',')}
           ON CONFLICT (id) DO UPDATE
             SET document = EXCLUDED.document,
                 metadata = EXCLUDED.metadata,
                 vector   = EXCLUDED.vector`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const reused = docs.filter((d) => d.vector).length;
    console.error(
      `[pgvector] Added ${docs.length} documents${reused ? ` (${reused} with precomputed vectors)` : ''}`,
    );
  }

  /** Replace the whole collection (TRUNCATE + insert) inside one transaction. */
  async replaceDocuments(docs: VectorDocument[]): Promise<void> {
    await this.ensureCollection();
    const pool = this.getPool();
    const rows = docs.length ? await this.rowsForDocuments(docs) : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`TRUNCATE ${this.table}`);
      const CHUNK = 500;
      for (let off = 0; off < rows.length; off += CHUNK) {
        const slice = rows.slice(off, off + CHUNK);
        const values: any[] = [];
        const tuples = slice.map((r, i) => {
          const b = i * 4;
          values.push(r.id, r.document, r.metadata, r.vector);
          return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, $${b + 4}::vector)`;
        });
        await client.query(
          `INSERT INTO ${this.table} (id, document, metadata, vector)
           VALUES ${tuples.join(',')}`,
          values,
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.error(`[pgvector] Replaced collection with ${docs.length} documents`);
  }

  /** Build a `metadata @> $n::jsonb` containment filter (typed, matches lancedb's ===). */
  private whereClause(where: Record<string, any> | undefined, params: any[]): string {
    if (!where || Object.keys(where).length === 0) return '';
    params.push(JSON.stringify(where));
    return `WHERE metadata @> $${params.length}::jsonb`;
  }

  async query(text: string, limit = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    await this.ensureCollection();
    const pool = this.getPool();
    const [queryEmbedding] = await this.embedder.embed([text], 'query');
    const params: any[] = [toVectorLiteral(queryEmbedding)];
    const filter = this.whereClause(where, params);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, document, metadata, vector <=> $1::vector AS distance
       FROM ${this.table}
       ${filter}
       ORDER BY vector <=> $1::vector ASC
       LIMIT $${params.length}`,
      params,
    );
    return {
      ids: rows.map((r) => r.id),
      documents: rows.map((r) => r.document ?? ''),
      distances: rows.map((r) => Number(r.distance)),
      metadatas: rows.map((r) => r.metadata ?? {}),
    };
  }

  async queryById(id: string, nResults = 5): Promise<VectorQueryResult> {
    await this.ensureCollection();
    const pool = this.getPool();
    const found = await pool.query(`SELECT vector::text AS vector FROM ${this.table} WHERE id = $1`, [id]);
    if (found.rows.length === 0) {
      throw new Error(`No embedding found for document: ${id}`);
    }
    const vector = found.rows[0].vector as string; // already a pgvector literal
    const { rows } = await pool.query(
      `SELECT id, document, metadata, vector <=> $1::vector AS distance
       FROM ${this.table}
       WHERE id <> $2
       ORDER BY vector <=> $1::vector ASC
       LIMIT $3`,
      [vector, id, nResults],
    );
    return {
      ids: rows.map((r) => r.id),
      documents: rows.map((r) => r.document ?? ''),
      distances: rows.map((r) => Number(r.distance)),
      metadatas: rows.map((r) => r.metadata ?? {}),
    };
  }

  async getStats(): Promise<{ count: number }> {
    try {
      await this.ensureCollection();
      const pool = this.getPool();
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${this.table}`);
      return { count: rows[0].n };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    const stats = await this.getStats();
    return { count: stats.count, name: this.collectionName };
  }

  async getAllEmbeddings(
    limit = 5000,
  ): Promise<{ ids: string[]; embeddings: number[][]; metadatas: any[] }> {
    await this.ensureCollection();
    const pool = this.getPool();
    const { rows } = await pool.query(
      `SELECT id, vector::text AS vector, metadata FROM ${this.table} ORDER BY id LIMIT $1`,
      [limit],
    );
    return {
      ids: rows.map((r) => r.id),
      embeddings: rows.map((r) => JSON.parse(r.vector) as number[]),
      metadatas: rows.map((r) => r.metadata ?? {}),
    };
  }
}
