/**
 * Indexer Preservation Tests
 *
 * Tests that oracle_learn documents are preserved during re-indexing.
 * This is critical for cross-repo knowledge sharing.
 *
 * Philosophy: "Nothing is Deleted" - oracle_learn docs have no local files
 * and must not be wiped during indexer runs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle, BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq, and, or, isNull, inArray } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';
import { storeDocuments } from './indexer/storage.ts';
import { parseRetroFile } from './indexer/parser.ts';
import type { VectorDocument, VectorStoreAdapter } from './vector/types.ts';
import { documentStorageId } from './document-identity.ts';
import fs from 'fs';

// ============================================================================
// Test Database Setup
// ============================================================================

let sqlite: Database;
let db: BunSQLiteDatabase<typeof schema>;
const TEST_DB_PATH = '/tmp/oracle-indexer-preservation-test.db';

beforeAll(() => {
  // Remove existing test db
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  sqlite = new Database(TEST_DB_PATH);
  db = drizzle(sqlite, { schema });

  // Create schema matching production
  sqlite.exec(`
    -- Main document index
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      display_id TEXT,
      content_digest TEXT,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      created_by TEXT
    );

    CREATE INDEX idx_type ON oracle_documents(type);
    CREATE INDEX idx_source ON oracle_documents(source_file);
    CREATE INDEX idx_project ON oracle_documents(project);
    CREATE INDEX idx_created_by ON oracle_documents(created_by);

    -- FTS5 virtual table
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    );
  `);
});

afterAll(() => {
  sqlite.close();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

beforeEach(() => {
  // Clear tables before each test
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
});

// ============================================================================
// Helper: Simulate Smart Deletion Logic
// ============================================================================

function simulateSmartDeletion(project: string | null): string[] {
  const docsToDelete = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(
      and(
        // Match current project OR universal (null)
        project
          ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project))
          : isNull(oracleDocuments.project),
        // Only delete indexer-created OR legacy (null) docs
        or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy))
      )
    )
    .all();

  const idsToDelete = docsToDelete.map(d => d.id);

  if (idsToDelete.length > 0) {
    db.delete(oracleDocuments)
      .where(inArray(oracleDocuments.id, idsToDelete))
      .run();

    // Delete from FTS
    const placeholders = idsToDelete.map(() => '?').join(',');
    sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${placeholders})`).run(...idsToDelete);
  }

  return idsToDelete;
}

function insertTestDoc(doc: {
  id: string;
  type: string;
  sourceFile: string;
  createdBy: string | null;
  project: string | null;
  content?: string;
}) {
  const now = Date.now();
  db.insert(oracleDocuments)
    .values({
      id: doc.id,
      type: doc.type,
      sourceFile: doc.sourceFile,
      concepts: '[]',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      createdBy: doc.createdBy,
      project: doc.project,
    })
    .run();

  sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)
  `).run(doc.id, doc.content || 'Test content', '');
}

// ============================================================================
// Preservation Tests
// ============================================================================

describe('Indexer Preservation - oracle_learn documents', () => {
  it('should preserve oracle_learn documents during re-index', () => {
    // Insert oracle_learn doc from another repo
    insertTestDoc({
      id: 'test-oracle-learn-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/test.md',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
    });

    // Insert indexer doc from current repo
    insertTestDoc({
      id: 'test-indexer-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/local.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    // Simulate indexer run for current repo
    const deleted = simulateSmartDeletion('github.com/current/repo');

    // Verify oracle_learn doc is preserved
    const preserved = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'test-oracle-learn-1')).get();
    expect(preserved).toBeDefined();
    expect(preserved?.createdBy).toBe('oracle_learn');

    // Verify indexer doc was deleted
    const notPreserved = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'test-indexer-1')).get();
    expect(notPreserved).toBeUndefined();

    expect(deleted).toContain('test-indexer-1');
    expect(deleted).not.toContain('test-oracle-learn-1');
  });

  it('should preserve oracle_learn docs from different projects', () => {
    // Insert oracle_learn docs from various projects
    insertTestDoc({
      id: 'learn-repo-a',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/a.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-a',
    });

    insertTestDoc({
      id: 'learn-repo-b',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/b.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-b',
    });

    // Simulate indexer run for repo-a
    simulateSmartDeletion('github.com/team/repo-a');

    // Both oracle_learn docs should be preserved
    const docA = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'learn-repo-a')).get();
    const docB = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'learn-repo-b')).get();

    expect(docA).toBeDefined();
    expect(docB).toBeDefined();
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('should delete indexer docs from current project only', () => {
    // Insert indexer doc from different project
    insertTestDoc({
      id: 'other-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/other.md',
      createdBy: 'indexer',
      project: 'github.com/other/repo',
    });

    // Insert indexer doc from current project
    insertTestDoc({
      id: 'current-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/current.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    // Simulate indexer run for current repo
    const deleted = simulateSmartDeletion('github.com/current/repo');

    // Other repo's doc should be preserved
    const otherDoc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'other-repo-doc')).get();
    expect(otherDoc).toBeDefined();

    // Current repo's doc should be deleted
    const currentDoc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'current-repo-doc')).get();
    expect(currentDoc).toBeUndefined();

    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('should delete universal (null project) indexer docs', () => {
    // Insert universal indexer doc (no project)
    insertTestDoc({
      id: 'universal-indexer-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/universal.md',
      createdBy: 'indexer',
      project: null,
    });

    // Insert project-specific doc
    insertTestDoc({
      id: 'project-specific-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/project.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    // Simulate indexer run for current repo
    const deleted = simulateSmartDeletion('github.com/current/repo');

    // Both should be deleted (universal + current project)
    expect(deleted).toContain('universal-indexer-doc');
    expect(deleted).toContain('project-specific-doc');
  });

  it('should preserve universal oracle_learn docs', () => {
    // Insert universal oracle_learn doc (created from a context without project detection)
    insertTestDoc({
      id: 'universal-learn-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/universal.md',
      createdBy: 'oracle_learn',
      project: null,
    });

    // Simulate indexer run
    const deleted = simulateSmartDeletion('github.com/any/repo');

    // Universal oracle_learn should be preserved
    const doc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'universal-learn-doc')).get();
    expect(doc).toBeDefined();
    expect(deleted).not.toContain('universal-learn-doc');
  });
});

describe('Indexer Preservation - legacy docs (null createdBy)', () => {
  it('should treat legacy docs (null createdBy) as indexer-created', () => {
    // Insert legacy doc (pre-createdBy field)
    insertTestDoc({
      id: 'legacy-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/legacy.md',
      createdBy: null,
      project: 'github.com/current/repo',
    });

    // Simulate indexer run
    const deleted = simulateSmartDeletion('github.com/current/repo');

    // Legacy doc should be deleted (treated as indexer doc)
    const doc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'legacy-doc')).get();
    expect(doc).toBeUndefined();
    expect(deleted).toContain('legacy-doc');
  });
});

describe('Indexer Preservation - FTS sync', () => {
  it('should delete from FTS table when deleting from oracle_documents', () => {
    // Insert doc with FTS content
    insertTestDoc({
      id: 'fts-test-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/fts.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
      content: 'Searchable content for FTS test',
    });

    // Verify FTS entry exists
    const ftsBefore = sqlite.prepare(
      'SELECT id FROM oracle_fts WHERE id = ?'
    ).get('fts-test-doc');
    expect(ftsBefore).toBeDefined();

    // Simulate indexer run
    simulateSmartDeletion('github.com/current/repo');

    // Verify FTS entry is also deleted
    const ftsAfter = sqlite.prepare(
      'SELECT id FROM oracle_fts WHERE id = ?'
    ).get('fts-test-doc');
    expect(ftsAfter).toBeFalsy(); // null or undefined
  });

  it('should preserve FTS entries for preserved documents', () => {
    // Insert oracle_learn doc
    insertTestDoc({
      id: 'fts-preserved-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/preserved.md',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
      content: 'This content should remain searchable',
    });

    // Simulate indexer run
    simulateSmartDeletion('github.com/current/repo');

    // FTS entry should still exist
    const fts = sqlite.prepare(
      'SELECT content FROM oracle_fts WHERE id = ?'
    ).get('fts-preserved-doc') as { content: string } | undefined;
    expect(fts).toBeDefined();
    expect(fts?.content).toBe('This content should remain searchable');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('should handle empty database gracefully', () => {
    // Run on empty database
    const deleted = simulateSmartDeletion('github.com/any/repo');
    expect(deleted).toEqual([]);
  });

  it('should handle database with only oracle_learn docs', () => {
    // Insert only oracle_learn docs
    insertTestDoc({
      id: 'only-learn-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/1.md',
      createdBy: 'oracle_learn',
      project: 'github.com/repo/1',
    });

    insertTestDoc({
      id: 'only-learn-2',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/2.md',
      createdBy: 'oracle_learn',
      project: 'github.com/repo/2',
    });

    // Run indexer - should delete nothing
    const deleted = simulateSmartDeletion('github.com/any/repo');
    expect(deleted).toEqual([]);

    // All docs should remain
    const count = db.select().from(oracleDocuments).all().length;
    expect(count).toBe(2);
  });

  it('should handle mixed createdBy values correctly', () => {
    // Insert docs with various createdBy values
    insertTestDoc({
      id: 'indexer-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/indexer.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    insertTestDoc({
      id: 'oracle-learn-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/learn.md',
      createdBy: 'oracle_learn',
      project: 'github.com/current/repo',
    });

    insertTestDoc({
      id: 'manual-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/manual.md',
      createdBy: 'manual',
      project: 'github.com/current/repo',
    });

    insertTestDoc({
      id: 'legacy-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/legacy.md',
      createdBy: null,
      project: 'github.com/current/repo',
    });

    // Run indexer
    const deleted = simulateSmartDeletion('github.com/current/repo');

    // Only indexer and legacy should be deleted
    expect(deleted).toContain('indexer-doc');
    expect(deleted).toContain('legacy-doc');
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');

    // Verify remaining docs
    const remaining = db.select({ id: oracleDocuments.id }).from(oracleDocuments).all();
    const remainingIds = remaining.map(d => d.id);
    expect(remainingIds).toContain('oracle-learn-doc');
    expect(remainingIds).toContain('manual-doc');
  });
});

class RecordingVectorStore implements VectorStoreAdapter {
  readonly name = 'recording';
  readonly batches: string[][] = [];

  async connect() {}
  async close() {}
  async ensureCollection() {}
  async deleteCollection() {}
  async addDocuments(documents: VectorDocument[]) {
    this.batches.push(documents.map(document => document.id));
  }
  async query() {
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
  async queryById() {
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
  async getStats() {
    return { count: 0 };
  }
  async getCollectionInfo() {
    return { count: 0, name: this.name };
  }
}

describe('Document storage - FTS replacement', () => {
  it('keeps one current FTS row when a document is re-indexed', async () => {
    const now = Date.now();
    const base = {
      id: 'fts-replacement-doc',
      type: 'learning' as const,
      source_file: 'learnings/fts-replacement.md',
      content: 'old content',
      concepts: ['fts'],
      created_at: now,
      updated_at: now,
    };
    const storageId = documentStorageId(null, base.id);

    await storeDocuments(sqlite, db, null, null, [base]);
    await storeDocuments(sqlite, db, null, null, [{ ...base, content: 'new content' }]);

    const rows = sqlite.prepare(
      'SELECT content FROM oracle_fts WHERE id = ?'
    ).all(storageId) as Array<{ content: string }>;
    expect(rows).toEqual([{ content: 'new content' }]);
  });

  it('re-indexes changed or missing vectors but skips complete unchanged rows', async () => {
    const now = Date.now();
    const vectorStore = new RecordingVectorStore();
    const document = {
      id: 'incremental-vector-doc',
      type: 'learning' as const,
      source_file: 'ψ/memory/learnings/incremental.md',
      content: 'stable content',
      concepts: ['indexing'],
      created_at: now,
      updated_at: now,
    };
    const storageId = documentStorageId(null, document.id);

    await storeDocuments(sqlite, db, vectorStore, null, [document]);
    await storeDocuments(sqlite, db, vectorStore, null, [document], false, new Set([storageId]));
    await storeDocuments(sqlite, db, vectorStore, null, [document], false, new Set());
    await storeDocuments(sqlite, db, vectorStore, null, [{
      ...document,
      content: 'changed content',
    }], false, new Set([storageId]));

    expect(vectorStore.batches).toEqual([
      [storageId],
      [storageId],
      [storageId],
    ]);
  });
});

describe('Retrospective parser - stable document identity', () => {
  it('distinguishes the same basename in different directories', () => {
    const content = '# Session Retrospective\n\n## Summary\n\nA sufficiently long retrospective section that must produce one indexed document.';
    const marchEight = parseRetroFile(
      'ψ/memory/retrospectives/2026-03/08/17.09_same-name.md',
      content
    );
    const marchNine = parseRetroFile(
      'ψ/memory/retrospectives/2026-03/09/17.09_same-name.md',
      content
    );

    expect(marchEight).toHaveLength(1);
    expect(marchNine).toHaveLength(1);
    expect(marchEight[0].id).not.toBe(marchNine[0].id);
    expect(parseRetroFile(
      'ψ/memory/retrospectives/2026-03/08/17.09_same-name.md',
      content
    )[0].id).toBe(marchEight[0].id);
  });
});
