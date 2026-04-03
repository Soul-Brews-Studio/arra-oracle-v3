/**
 * LanceDB Adapter
 *
 * Serverless columnar vector DB. Stores data as Lance files on disk.
 * Uses EmbeddingProvider since LanceDB doesn't generate embeddings.
 */

import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider } from '../types.ts';

export class LanceDBAdapter implements VectorStoreAdapter {
  readonly name = 'lancedb';
  private db: any = null;
  private table: any = null;
  private dbPath: string;
  private collectionName: string;
  private embedder: EmbeddingProvider;

  constructor(collectionName: string, dbPath: string, embedder: EmbeddingProvider) {
    this.collectionName = collectionName;
    this.dbPath = dbPath;
    this.embedder = embedder;
  }

  async connect(): Promise<void> {
    if (this.db) return;

    const lancedb = await import('@lancedb/lancedb');
    this.db = await lancedb.connect(this.dbPath);
    console.log(`[LanceDB] Connected at ${this.dbPath}`);
  }

  async close(): Promise<void> {
    this.db = null;
    this.table = null;
    console.log('[LanceDB] Closed');
  }

  async ensureCollection(): Promise<void> {
    if (!this.db) throw new Error('LanceDB not connected');

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.collectionName)) {
      this.table = await this.db.openTable(this.collectionName);
    } else {
      // Create with a schema-defining dummy row, then delete it
      const dims = this.embedder.dimensions;
      this.table = await this.db.createTable(this.collectionName, [{
        id: '__init__',
        text: '',
        metadata: '{}',
        vector: new Array(dims).fill(0),
      }]);
      await this.table.delete('id = "__init__"');
    }

    console.log(`[LanceDB] Collection '${this.collectionName}' ready`);
  }

  async deleteCollection(): Promise<void> {
    if (!this.db) throw new Error('LanceDB not connected');

    try {
      await this.db.dropTable(this.collectionName);
      this.table = null;
      console.log(`[LanceDB] Collection '${this.collectionName}' deleted`);
    } catch (e) {
      console.warn('[LanceDB] deleteCollection failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    if (!this.table) await this.ensureCollection();

    const texts = docs.map(d => d.document);
    const embeddings = await this.embedder.embed(texts);

    const rows = docs.map((doc, i) => ({
      id: doc.id,
      text: doc.document,
      metadata: JSON.stringify(doc.metadata),
      vector: embeddings[i],
    }));

    await this.table.add(rows);
    console.log(`[LanceDB] Added ${docs.length} documents`);
  }

  async query(text: string, limit: number = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    if (!this.table) await this.ensureCollection();

    const [queryEmbedding] = await this.embedder.embed([text]);

    // Fetch extra results if filtering in JS (metadata is stored as string, not binary)
    const fetchLimit = where ? limit * 3 : limit;
    const results = await this.table.search(queryEmbedding).limit(fetchLimit).toArray();

    // Filter metadata in JavaScript (LanceDB json_extract requires LargeBinary, not Utf8)
    let filtered = results;
    if (where) {
      filtered = results.filter((r: any) => {
        const meta = JSON.parse(r.metadata || '{}');
        return Object.entries(where).every(([k, v]) => meta[k] === v);
      }).slice(0, limit);
    }

    return {
      ids: filtered.map((r: any) => r.id),
      documents: filtered.map((r: any) => r.text),
      distances: filtered.map((r: any) => r._distance ?? 0),
      metadatas: filtered.map((r: any) => JSON.parse(r.metadata || '{}')),
    };
  }

  async queryById(id: string, nResults: number = 5): Promise<VectorQueryResult> {
    if (!this.table) await this.ensureCollection();

    // Get the document's vector using filter query (not vector search)
    const rows = await this.table.query().where(`id = '${id}'`).limit(1).toArray();
    if (rows.length === 0) {
      throw new Error(`No embedding found for document: ${id}`);
    }

    const vector = Array.from(rows[0].vector);
    const results = await this.table.search(vector).limit(nResults + 1).toArray();

    const filtered = results.filter((r: any) => r.id !== id).slice(0, nResults);

    return {
      ids: filtered.map((r: any) => r.id),
      documents: filtered.map((r: any) => r.text),
      distances: filtered.map((r: any) => r._distance ?? 0),
      metadatas: filtered.map((r: any) => JSON.parse(r.metadata || '{}')),
    };
  }

  async getStats(): Promise<{ count: number }> {
    if (!this.table) {
      // Try to open existing table
      if (this.db) {
        try {
          const tableNames = await this.db.tableNames();
          if (tableNames.includes(this.collectionName)) {
            this.table = await this.db.openTable(this.collectionName);
          }
        } catch { /* expected: optional resource */ }
      }
      if (!this.table) return { count: 0 };
    }
    try {
      const count = await this.table.countRows();
      return { count };
    } catch {
      return { count: 0 };
    }
  }

  async getCollectionInfo(): Promise<{ count: number; name: string }> {
    const stats = await this.getStats();
    return { count: stats.count, name: this.collectionName };
  }

  async getAllEmbeddings(limit: number = 5000): Promise<{ ids: string[]; embeddings: number[][]; metadatas: any[] }> {
    if (!this.table) return { ids: [], embeddings: [], metadatas: [] };

    const rows = await this.table.query().limit(limit).toArray();

    return {
      ids: rows.map((r: any) => r.id),
      embeddings: rows.map((r: any) => Array.from(r.vector)),
      metadatas: rows.map((r: any) => JSON.parse(r.metadata || '{}')),
    };
  }
}
