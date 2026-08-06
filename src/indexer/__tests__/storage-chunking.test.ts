import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import { storeDocuments } from '../storage.ts';
import type { OracleDocument } from '../../types.ts';
import type { VectorDocument, VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';

class FakeVectorStore implements VectorStoreAdapter {
  readonly name = 'fake-vector';
  docs: VectorDocument[] = [];
  async connect() {}
  async close() {}
  async ensureCollection() {}
  async deleteCollection() { this.docs = []; }
  async addDocuments(docs: VectorDocument[]) { this.docs.push(...docs); }
  async replaceDocuments(docs: VectorDocument[]) { this.docs = docs; }
  async query(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async queryById(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async getStats() { return { count: this.docs.length }; }
  async getCollectionInfo() { return { count: this.docs.length, name: this.name }; }
}

function doc(content: string): OracleDocument {
  return {
    id: 'long-learning',
    type: 'learning',
    source_file: 'ψ/memory/learnings/long.md',
    content,
    concepts: ['chunking', 'line-map'],
    created_at: 1,
    updated_at: 1,
  };
}

describe('storeDocuments chunking', () => {
  test('stores paragraph chunks in SQLite/FTS and vector metadata', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-chunking-'));
    const dbPath = path.join(tmp, 'oracle.db');
    const conn = createDatabase(dbPath);
    const vector = new FakeVectorStore();
    const para = (label: string, char: string) => `${label} ${char.repeat(330)}`;
    const content = `${para('alpha CORS', 'a')}\n\n${para('beta', 'b')}\n\n${para('gamma', 'c')}`;

    try {
      await storeDocuments(conn.sqlite, conn.db, vector, null, [doc(content)], { tenantId: 'default' });

      const rows = conn.sqlite.prepare(`
        SELECT d.id, f.content FROM oracle_documents d
        JOIN oracle_fts f ON f.id = d.id
        WHERE d.source_file = ?
        ORDER BY d.id
      `).all('ψ/memory/learnings/long.md') as Array<{ id: string; content: string }>;

      expect(rows.map((row) => row.id)).toEqual(['long-learning__chunk_0', 'long-learning__chunk_1']);
      expect(rows[0].content).toContain('alpha');
      expect(rows[0].content).toContain('beta');
      expect(rows[0].content).not.toContain('gamma');
      expect(rows[0].content).toContain('Search expansions:');
      expect(rows[0].content).toContain('Cross-Origin Resource Sharing');
      expect(vector.docs[0].document).toContain('Cross-Origin Resource Sharing');
      expect(rows[1].content).toContain('gamma');
      expect(vector.docs.map((item) => item.id)).toEqual(rows.map((row) => row.id));
      expect(vector.docs.map((item) => item.metadata.chunk_index)).toEqual([0, 1]);
      expect(vector.docs.map((item) => item.metadata.line_start)).toEqual([1, 5]);
      expect(vector.docs.map((item) => item.metadata.line_end)).toEqual([3, 5]);
    } finally {
      conn.storage.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
