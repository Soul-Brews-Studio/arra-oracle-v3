/**
 * LanceDB Adapter
 *
 * Serverless columnar vector DB. Stores data as Lance files on disk.
 * Uses EmbeddingProvider since LanceDB doesn't generate embeddings.
 */

import type { VectorStoreAdapter, VectorDocument, VectorQueryResult, EmbeddingProvider } from '../types.ts';

const FILTER_COLUMNS: Record<string, true> = {
  type: true,
  project: true,
  display_id: true,
  content_digest: true,
};

function filterPredicate(where: Record<string, unknown>): string {
  return Object.entries(where).map(([column, value]) => {
    if (!FILTER_COLUMNS[column]) throw new Error(`Unsupported LanceDB filter: ${column}`);
    if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string')) {
      return `${column} IN (${value.map((item) => `'${item.replaceAll("'", "''")}'`).join(', ')})`;
    }
    if (typeof value === 'string') return `${column} = '${value.replaceAll("'", "''")}'`;
    if (typeof value === 'number' && Number.isFinite(value)) return `${column} = ${value}`;
    if (typeof value === 'boolean') return `${column} = ${value}`;
    throw new Error(`Unsupported LanceDB filter value for ${column}`);
  }).join(' AND ');
}

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
    console.error(`[LanceDB] Connected at ${this.dbPath}`);
  }

  async close(): Promise<void> {
    try {
      if (this.table && typeof this.table.close === 'function') this.table.close();
    } catch {}
    this.db = null;
    this.table = null;
    console.error('[LanceDB] Closed');
  }

  async ensureCollection(): Promise<void> {
    // Self-connect if a caller reaches a query/write path without an explicit
    // connect() first. The MCP server builds the default vector store but only
    // connect()s the per-model registry stores — so hybrid/default searches hit
    // this with this.db === null and used to throw "LanceDB not connected",
    // which vectorSearch() swallowed into [] (silent FTS-only fallback). connect()
    // is idempotent (early-returns when this.db is set), so this is safe to call
    // on every path. See vector/factory.ts getVectorStoreByModel for the
    // registry path that already pre-connects.
    if (!this.db) await this.connect();

    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.collectionName)) {
      this.table = await this.db.openTable(this.collectionName);
    } else {
      // Create with a schema-defining dummy row, then delete it
      const dims = this.embedder.dimensions;
      this.table = await this.db.createTable(this.collectionName, [{
        id: '__init__',
        text: '',
        type: '',
        project: '',
        display_id: '',
        content_digest: '',
        metadata: '{}',
        vector: new Array(dims).fill(0),
      }]);
      await this.table.delete('id = "__init__"');
    }

    console.error(`[LanceDB] Collection '${this.collectionName}' ready`);
  }

  /**
   * Refresh a long-lived table handle to the latest manifest version.
   *
   * `index-model.ts` historically dropped and recreated the table while MCP or
   * the HTTP server still held a LanceDB Table object. A subsequent write on
   * that stale object can return success while fresh readers fail with missing
   * data files (#987). LanceDB exposes checkoutLatest() for long-lived table
   * handles; call it before reads/writes and reopen as a last-resort fallback.
   */
  private async checkoutLatest(): Promise<void> {
    if (!this.db || !this.table) return;
    try {
      if (typeof this.table.checkoutLatest === 'function') {
        await this.table.checkoutLatest();
      }
    } catch (e) {
      console.warn('[LanceDB] checkoutLatest failed, reopening table:', e instanceof Error ? e.message : String(e));
      this.table = await this.db.openTable(this.collectionName);
    }
  }

  async deleteCollection(): Promise<void> {
    if (!this.db) throw new Error('LanceDB not connected');

    try {
      await this.db.dropTable(this.collectionName);
      this.table = null;
      console.error(`[LanceDB] Collection '${this.collectionName}' deleted`);
    } catch (e) {
      console.warn('[LanceDB] deleteCollection failed:', e instanceof Error ? e.message : String(e));
    }
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (docs.length === 0) return;
    if (!this.table) await this.ensureCollection();
    await this.checkoutLatest();

    const rows = await this.rowsForDocuments(docs);

    await this.table.add(rows);
    const reused = docs.filter(doc => doc.vector).length;
    if (reused > 0) {
      console.error(`[LanceDB] Added ${docs.length} documents (${reused} with precomputed vectors)`);
    } else {
      console.error(`[LanceDB] Added ${docs.length} documents`);
    }
  }

  /**
   * Replace all rows while preserving the table identity.
   *
   * This is intentionally NOT `dropTable()` + `createTable()`: other live
   * processes may hold Table handles. LanceDB's add({ mode: 'overwrite' })
   * writes a new table version instead of invalidating those handles.
   */
  async replaceDocuments(docs: VectorDocument[]): Promise<void> {
    if (!this.table) await this.ensureCollection();
    await this.checkoutLatest();

    if (docs.length === 0) {
      await this.table.delete('id IS NOT NULL');
      console.error('[LanceDB] Replaced collection with 0 documents');
      return;
    }

    const rows = await this.rowsForDocuments(docs);
    await this.table.add(rows, { mode: 'overwrite' });
    const reused = docs.filter(doc => doc.vector).length;
    if (reused > 0) {
      console.error(`[LanceDB] Replaced collection with ${docs.length} documents (${reused} with precomputed vectors)`);
    } else {
      console.error(`[LanceDB] Replaced collection with ${docs.length} documents`);
    }
  }

  private async rowsForDocuments(docs: VectorDocument[]): Promise<Array<{
    id: string;
    text: string;
    metadata: string;
    vector: number[];
  }>> {
    // Embed only the docs that lack a precomputed vector. Callers that
    // already have a vector (e.g. the indexer worker loop, where embed
    // happens before the storage write) skip the second Ollama round-trip.
    const needEmbed: number[] = [];
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i].vector) needEmbed.push(i);
    }
    let fresh: number[][] = [];
    if (needEmbed.length > 0) {
      const texts = needEmbed.map(i => docs[i].document);
      fresh = await this.embedder.embed(texts, 'passage');
    }
    let freshIdx = 0;

    const rows = docs.map((doc) => ({
      id: doc.id,
      text: doc.document,
      metadata: JSON.stringify(doc.metadata),
      type: String(doc.metadata.type || ''),
      project: String(doc.metadata.project || ''),
      display_id: String(doc.metadata.display_id || ''),
      content_digest: String(doc.metadata.content_digest || ''),
      vector: doc.vector ?? fresh[freshIdx++],
    }));
    return rows;
  }

  async query(text: string, limit: number = 10, where?: Record<string, any>): Promise<VectorQueryResult> {
    if (!this.table) await this.ensureCollection();
    await this.checkoutLatest();

    const [queryEmbedding] = await this.embedder.embed([text], 'query');

    let search = this.table.search(queryEmbedding).distanceType('cosine');
    if (where && Object.keys(where).length > 0) {
      search = search.where(filterPredicate(where));
    }
    const results = await search.limit(limit).toArray();

    const filtered = results;

    return {
      ids: filtered.map((r: any) => r.id),
      documents: filtered.map((r: any) => r.text),
      distances: filtered.map((r: any) => r._distance ?? 0),
      metadatas: filtered.map((r: any) => JSON.parse(r.metadata || '{}')),
    };
  }

  async queryById(id: string, nResults: number = 5): Promise<VectorQueryResult> {
    if (!this.table) await this.ensureCollection();
    await this.checkoutLatest();

    // Get the document's vector using filter query (not vector search)
    const rows = await this.table.query().where(`id = '${id.replaceAll("'", "''")}'`).limit(1).toArray();
    if (rows.length === 0) {
      throw new Error(`No embedding found for document: ${id}`);
    }

    const vector = Array.from(rows[0].vector);
    const results = await this.table.search(vector).distanceType('cosine').limit(nResults + 1).toArray();

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
      // Self-connect first so health checks report the real row count instead
      // of a false 0. verifyVectorHealth() calls getStats() before any query;
      // without this it saw this.db === null, returned { count: 0 }, and set
      // vectorStatus = 'connected' while the store was never actually opened.
      if (!this.db) {
        try { await this.connect(); } catch {}
      }
      // Try to open existing table
      if (this.db) {
        try {
          const tableNames = await this.db.tableNames();
          if (tableNames.includes(this.collectionName)) {
            this.table = await this.db.openTable(this.collectionName);
          }
        } catch {}
      }
      if (!this.table) return { count: 0 };
    }
    await this.checkoutLatest();
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
    await this.checkoutLatest();

    const rows = await this.table.query().limit(limit).toArray();

    return {
      ids: rows.map((r: any) => r.id),
      embeddings: rows.map((r: any) => Array.from(r.vector)),
      metadatas: rows.map((r: any) => JSON.parse(r.metadata || '{}')),
    };
  }
}
