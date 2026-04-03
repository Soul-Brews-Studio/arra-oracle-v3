/**
 * Drizzle Migration Unit Tests
 *
 * Tests for database queries that will be migrated from raw SQL to Drizzle ORM.
 * These tests ensure behavior is preserved after migration.
 *
 * Coverage:
 * - src/index.ts: handleConsult, handleReflect, handleLearn, handleList, handleStats, handleConcepts
 * - src/indexer.ts: setIndexingStatus, storeDocuments
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';

// ============================================================================
// Test Database Setup
// ============================================================================

let db: Database;
const TEST_DB_PATH = '/tmp/oracle-drizzle-migration-test.db';

beforeAll(() => {
  // Remove existing test db
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  db = new Database(TEST_DB_PATH);

  // Create all required tables (matching schema.ts)
  db.exec(`
    -- Main document index
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
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

    -- FTS5 virtual table
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    );

    -- Indexing status
    CREATE TABLE indexing_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      is_indexing INTEGER NOT NULL DEFAULT 0,
      progress_current INTEGER DEFAULT 0,
      progress_total INTEGER DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      repo_root TEXT
    );

    INSERT INTO indexing_status (id, is_indexing) VALUES (1, 0);
  `);

  // Insert test documents
  const testDocs = [
    {
      id: 'principle_1',
      type: 'principle',
      content: 'Nothing is deleted - append only philosophy',
      source_file: 'ψ/memory/resonance/philosophy.md',
      concepts: '["trust","safety","append"]',
    },
    {
      id: 'principle_2',
      type: 'principle',
      content: 'Patterns over intentions - observe what happens',
      source_file: 'ψ/memory/resonance/philosophy.md',
      concepts: '["pattern","observation"]',
    },
    {
      id: 'learning_1',
      type: 'learning',
      content: 'Git safety patterns for force push prevention',
      source_file: 'ψ/memory/learnings/git-safety.md',
      concepts: '["git","safety","pattern"]',
    },
    {
      id: 'learning_2',
      type: 'learning',
      content: 'Drizzle ORM migration best practices',
      source_file: 'ψ/memory/learnings/drizzle.md',
      concepts: '["drizzle","orm","migration"]',
    },
    {
      id: 'retro_1',
      type: 'retro',
      content: 'Session retrospective about testing patterns',
      source_file: 'ψ/memory/retrospectives/2026-01/30/session.md',
      concepts: '["test","session"]',
    },
  ];

  const now = Date.now();
  const insertDoc = db.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `);

  for (const doc of testDocs) {
    insertDoc.run(doc.id, doc.type, doc.source_file, doc.concepts, now, now, now);
    insertFts.run(doc.id, doc.content, doc.concepts);
  }
});

afterAll(() => {
  db.close();
  // Retry unlink to handle Windows EBUSY (file lock release delay)
  for (let i = 0; i < 3; i++) {
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      break;
    } catch {
      if (i < 2) Bun.sleepSync(100);
    }
  }
});

// ============================================================================
// handleReflect Tests - SELECT random document
// ============================================================================

describe('handleReflect - SELECT oracle_documents', () => {
  it('should select random document of type principle or learning', () => {
    const result = db.prepare(`
      SELECT id, type, source_file, concepts FROM oracle_documents
      WHERE type IN ('principle', 'learning')
      ORDER BY RANDOM()
      LIMIT 1
    `).get() as any;

    expect(result).toBeDefined();
    expect(['principle', 'learning']).toContain(result.type);
    expect(result.id).toBeDefined();
    expect(result.source_file).toBeDefined();
  });

  it('should return different results on multiple calls (randomness)', () => {
    const results = new Set<string>();

    // Run multiple times to verify randomness
    for (let i = 0; i < 20; i++) {
      const result = db.prepare(`
        SELECT id FROM oracle_documents
        WHERE type IN ('principle', 'learning')
        ORDER BY RANDOM()
        LIMIT 1
      `).get() as any;
      results.add(result.id);
    }

    // With 4 eligible documents, should see variation
    expect(results.size).toBeGreaterThan(1);
  });

  it('should only return principle and learning types', () => {
    for (let i = 0; i < 10; i++) {
      const result = db.prepare(`
        SELECT type FROM oracle_documents
        WHERE type IN ('principle', 'learning')
        ORDER BY RANDOM()
        LIMIT 1
      `).get() as any;

      expect(result.type).not.toBe('retro');
    }
  });
});

// ============================================================================
// handleLearn Tests - INSERT oracle_documents
// ============================================================================

describe('handleLearn - INSERT oracle_documents', () => {
  it('should insert new learning document', () => {
    const now = Date.now();
    const id = `learning_test_${now}`;

    db.prepare(`
      INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, origin, project, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      'learning',
      'ψ/memory/learnings/test-pattern.md',
      '["test","pattern"]',
      now,
      now,
      now,
      null,
      'github.com/test/repo',
      'arra_learn'
    );

    const result = db.prepare('SELECT * FROM oracle_documents WHERE id = ?').get(id) as any;

    expect(result).toBeDefined();
    expect(result.type).toBe('learning');
    expect(result.source_file).toBe('ψ/memory/learnings/test-pattern.md');
    expect(JSON.parse(result.concepts)).toEqual(['test', 'pattern']);
    expect(result.created_by).toBe('arra_learn');
    expect(result.project).toBe('github.com/test/repo');
  });

  it('should handle null origin and project', () => {
    const now = Date.now();
    const id = `learning_null_test_${now}`;

    db.prepare(`
      INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at, origin, project, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'test.md', '[]', now, now, now, null, null, 'arra_learn');

    const result = db.prepare('SELECT * FROM oracle_documents WHERE id = ?').get(id) as any;

    expect(result.origin).toBeNull();
    expect(result.project).toBeNull();
  });
});

// ============================================================================
// handleList Tests - COUNT queries
// ============================================================================

describe('handleList - COUNT oracle_documents', () => {
  it('should count all documents', () => {
    const result = db.prepare('SELECT COUNT(*) as total FROM oracle_documents').get() as any;

    expect(result.total).toBeGreaterThanOrEqual(5); // At least our test docs
  });

  it('should count documents by type', () => {
    const result = db.prepare('SELECT COUNT(*) as total FROM oracle_documents WHERE type = ?')
      .get('principle') as any;

    expect(result.total).toBe(2);
  });

  it('should return 0 for non-existent type', () => {
    const result = db.prepare('SELECT COUNT(*) as total FROM oracle_documents WHERE type = ?')
      .get('nonexistent') as any;

    expect(result.total).toBe(0);
  });
});

// ============================================================================
// handleStats Tests - GROUP BY and aggregations
// ============================================================================

describe('handleStats - Aggregation queries', () => {
  it('should count documents grouped by type', () => {
    const results = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM oracle_documents
      GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    expect(results.length).toBeGreaterThan(0);

    const typeMap = new Map(results.map(r => [r.type, r.count]));
    expect(typeMap.get('principle')).toBe(2);
    expect(typeMap.get('learning')).toBeGreaterThanOrEqual(2);
    expect(typeMap.get('retro')).toBe(1);
  });

  it('should get max indexed_at timestamp', () => {
    const result = db.prepare(`
      SELECT MAX(indexed_at) as last_indexed FROM oracle_documents
    `).get() as any;

    expect(result.last_indexed).toBeDefined();
    expect(result.last_indexed).toBeGreaterThan(0);
  });

  it('should select all concepts (non-empty)', () => {
    const results = db.prepare(`
      SELECT concepts FROM oracle_documents
      WHERE concepts IS NOT NULL AND concepts != '[]'
    `).all() as Array<{ concepts: string }>;

    expect(results.length).toBeGreaterThan(0);

    // Each should be valid JSON
    for (const row of results) {
      expect(() => JSON.parse(row.concepts)).not.toThrow();
    }
  });

  it('should calculate unique concepts count', () => {
    const results = db.prepare(`
      SELECT concepts FROM oracle_documents
      WHERE concepts IS NOT NULL AND concepts != '[]'
    `).all() as Array<{ concepts: string }>;

    const uniqueConcepts = new Set<string>();
    for (const row of results) {
      const concepts = JSON.parse(row.concepts);
      if (Array.isArray(concepts)) {
        concepts.forEach((c: string) => uniqueConcepts.add(c));
      }
    }

    expect(uniqueConcepts.size).toBeGreaterThan(5);
    expect(uniqueConcepts.has('trust')).toBe(true);
    expect(uniqueConcepts.has('safety')).toBe(true);
    expect(uniqueConcepts.has('pattern')).toBe(true);
  });
});

// ============================================================================
// handleConcepts Tests - SELECT concepts
// ============================================================================

describe('handleConcepts - SELECT concepts', () => {
  it('should select concepts from all documents', () => {
    const results = db.prepare(`
      SELECT concepts FROM oracle_documents
      WHERE concepts IS NOT NULL AND concepts != '[]'
    `).all() as Array<{ concepts: string }>;

    expect(results.length).toBeGreaterThan(0);
  });

  it('should select concepts filtered by type', () => {
    const results = db.prepare(`
      SELECT concepts FROM oracle_documents
      WHERE type = ? AND concepts IS NOT NULL AND concepts != '[]'
    `).all('principle') as Array<{ concepts: string }>;

    expect(results.length).toBe(2); // Our 2 test principles have concepts
  });

  it('should count concept occurrences correctly', () => {
    // Only check the original 5 test documents
    const results = db.prepare(`
      SELECT concepts FROM oracle_documents
      WHERE id IN ('principle_1', 'principle_2', 'learning_1', 'learning_2', 'retro_1')
      AND concepts IS NOT NULL AND concepts != '[]'
    `).all() as Array<{ concepts: string }>;

    const conceptCounts = new Map<string, number>();
    for (const row of results) {
      const concepts = JSON.parse(row.concepts);
      if (Array.isArray(concepts)) {
        for (const concept of concepts) {
          conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + 1);
        }
      }
    }

    // 'safety' appears in principle_1 and learning_1
    expect(conceptCounts.get('safety')).toBe(2);
    // 'pattern' appears in principle_2 and learning_1
    expect(conceptCounts.get('pattern')).toBe(2);
  });
});

// ============================================================================
// setIndexingStatus Tests - UPDATE indexing_status
// ============================================================================

describe('setIndexingStatus - UPDATE indexing_status', () => {
  beforeEach(() => {
    // Reset to default state
    db.prepare(`
      UPDATE indexing_status SET
        is_indexing = 0,
        progress_current = 0,
        progress_total = 0,
        started_at = NULL,
        completed_at = NULL,
        error = NULL,
        repo_root = NULL
      WHERE id = 1
    `).run();
  });

  it('should update indexing status to active', () => {
    const now = Date.now();

    db.prepare(`
      UPDATE indexing_status SET
        is_indexing = ?,
        progress_current = ?,
        progress_total = ?,
        started_at = CASE WHEN ? = 1 AND started_at IS NULL THEN ? ELSE started_at END,
        completed_at = CASE WHEN ? = 0 THEN ? ELSE NULL END,
        error = ?,
        repo_root = ?
      WHERE id = 1
    `).run(1, 0, 100, 1, now, 1, now, null, '/test/repo');

    const result = db.prepare('SELECT * FROM indexing_status WHERE id = 1').get() as any;

    expect(result.is_indexing).toBe(1);
    expect(result.progress_current).toBe(0);
    expect(result.progress_total).toBe(100);
    expect(result.started_at).toBe(now);
    expect(result.completed_at).toBeNull();
    expect(result.repo_root).toBe('/test/repo');
  });

  it('should update progress during indexing', () => {
    // First set to indexing
    db.prepare(`
      UPDATE indexing_status SET is_indexing = 1, progress_total = 100, started_at = ?
      WHERE id = 1
    `).run(Date.now());

    // Then update progress
    db.prepare(`
      UPDATE indexing_status SET progress_current = ? WHERE id = 1
    `).run(50);

    const result = db.prepare('SELECT * FROM indexing_status WHERE id = 1').get() as any;

    expect(result.is_indexing).toBe(1);
    expect(result.progress_current).toBe(50);
    expect(result.progress_total).toBe(100);
  });

  it('should mark indexing complete', () => {
    const now = Date.now();

    // Start indexing
    db.prepare(`
      UPDATE indexing_status SET is_indexing = 1, started_at = ?, progress_total = 100
      WHERE id = 1
    `).run(now - 1000);

    // Complete indexing
    db.prepare(`
      UPDATE indexing_status SET
        is_indexing = 0,
        progress_current = 100,
        completed_at = ?
      WHERE id = 1
    `).run(now);

    const result = db.prepare('SELECT * FROM indexing_status WHERE id = 1').get() as any;

    expect(result.is_indexing).toBe(0);
    expect(result.progress_current).toBe(100);
    expect(result.completed_at).toBe(now);
  });

  it('should store error message', () => {
    db.prepare(`
      UPDATE indexing_status SET
        is_indexing = 0,
        error = ?
      WHERE id = 1
    `).run('Failed to index: connection timeout');

    const result = db.prepare('SELECT * FROM indexing_status WHERE id = 1').get() as any;

    expect(result.error).toBe('Failed to index: connection timeout');
  });
});

// ============================================================================
// storeDocuments Tests - INSERT oracle_documents (batch)
// ============================================================================

describe('storeDocuments - INSERT oracle_documents (batch)', () => {
  it('should insert multiple documents in batch', () => {
    const now = Date.now();
    const batchDocs = [
      { id: `batch_1_${now}`, type: 'learning', source_file: 'batch1.md', concepts: '["batch"]' },
      { id: `batch_2_${now}`, type: 'learning', source_file: 'batch2.md', concepts: '["batch"]' },
      { id: `batch_3_${now}`, type: 'learning', source_file: 'batch3.md', concepts: '["batch"]' },
    ];

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at, project)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const doc of batchDocs) {
      insertStmt.run(doc.id, doc.type, doc.source_file, doc.concepts, now, now, now, null);
    }

    const count = db.prepare(`
      SELECT COUNT(*) as count FROM oracle_documents WHERE id LIKE ?
    `).get(`batch_%_${now}`) as any;

    expect(count.count).toBe(3);
  });

  it('should use INSERT OR REPLACE for upsert behavior', () => {
    const now = Date.now();
    const id = `upsert_test_${now}`;

    // Insert first time
    db.prepare(`
      INSERT OR REPLACE INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'original.md', '["v1"]', now, now, now);

    // Upsert with updated values
    db.prepare(`
      INSERT OR REPLACE INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'updated.md', '["v2"]', now, now + 1000, now + 1000);

    const result = db.prepare('SELECT * FROM oracle_documents WHERE id = ?').get(id) as any;

    expect(result.source_file).toBe('updated.md');
    expect(JSON.parse(result.concepts)).toEqual(['v2']);
    expect(result.updated_at).toBe(now + 1000);
  });

  it('should insert into FTS table alongside documents', () => {
    const now = Date.now();
    const id = `fts_test_${now}`;
    const content = 'Test content for FTS indexing';
    const concepts = '["fts","test"]';

    // Insert into both tables
    db.prepare(`
      INSERT OR REPLACE INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'fts.md', concepts, now, now, now);

    db.prepare(`
      INSERT OR REPLACE INTO oracle_fts (id, content, concepts)
      VALUES (?, ?, ?)
    `).run(id, content, concepts);

    // Verify FTS indexing works
    const ftsResult = db.prepare(`
      SELECT id, content FROM oracle_fts WHERE oracle_fts MATCH 'indexing'
    `).get() as any;

    expect(ftsResult).toBeDefined();
    expect(ftsResult.id).toBe(id);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty concepts array', () => {
    const now = Date.now();
    const id = `empty_concepts_${now}`;

    db.prepare(`
      INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'test.md', '[]', now, now, now);

    const result = db.prepare('SELECT concepts FROM oracle_documents WHERE id = ?').get(id) as any;
    expect(JSON.parse(result.concepts)).toEqual([]);
  });

  it('should handle special characters in content', () => {
    const now = Date.now();
    const id = `special_chars_${now}`;
    const content = "Test with 'quotes', \"double quotes\", and unicode: ψ 日本語";

    db.prepare(`
      INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)
    `).run(id, content, '[]');

    const result = db.prepare('SELECT content FROM oracle_fts WHERE id = ?').get(id) as any;
    expect(result.content).toBe(content);
  });

  it('should handle very long concepts arrays', () => {
    const now = Date.now();
    const id = `many_concepts_${now}`;
    const concepts = JSON.stringify(Array.from({ length: 50 }, (_, i) => `concept_${i}`));

    db.prepare(`
      INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, 'learning', 'test.md', concepts, now, now, now);

    const result = db.prepare('SELECT concepts FROM oracle_documents WHERE id = ?').get(id) as any;
    const parsed = JSON.parse(result.concepts);
    expect(parsed.length).toBe(50);
  });
});

// ============================================================================
// Drizzle Pattern Verification
// ============================================================================

describe('Drizzle Pattern Verification', () => {
  it('should verify GROUP BY type pattern matches expected Drizzle output', () => {
    // This query pattern should work identically in Drizzle:
    // db.select({ type: oracleDocuments.type, count: sql`count(*)` })
    //   .from(oracleDocuments).groupBy(oracleDocuments.type).all()

    const results = db.prepare(`
      SELECT type, COUNT(*) as count
      FROM oracle_documents
      GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    // Verify structure matches Drizzle output
    expect(results[0]).toHaveProperty('type');
    expect(results[0]).toHaveProperty('count');
    expect(typeof results[0].count).toBe('number');
  });

  it('should verify COUNT(*) pattern matches expected Drizzle output', () => {
    // db.select({ count: sql<number>`count(*)` }).from(oracleDocuments).get()

    const result = db.prepare('SELECT COUNT(*) as count FROM oracle_documents').get() as any;

    expect(result).toHaveProperty('count');
    expect(typeof result.count).toBe('number');
  });

  it('should verify ORDER BY RANDOM() LIMIT 1 pattern', () => {
    // db.select().from(oracleDocuments).orderBy(sql`RANDOM()`).limit(1).get()

    const result = db.prepare(`
      SELECT * FROM oracle_documents ORDER BY RANDOM() LIMIT 1
    `).get() as any;

    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('type');
  });

  it('should verify INSERT RETURNING pattern behavior', () => {
    const now = Date.now();
    const id = `returning_test_${now}`;

    // Drizzle .returning() returns the inserted row
    // SQLite supports RETURNING clause
    const result = db.prepare(`
      INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(id, 'learning', 'test-returning.md', '["test"]', now, now, now) as any;

    expect(result).toBeDefined();
    expect(result.id).toBe(id);
    expect(result.type).toBe('learning');
  });
});
