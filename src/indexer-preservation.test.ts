/**
 * Indexer preservation tests ensure oracle_learn/manual docs survive re-index
 * smart-deletion while indexer/legacy rows and matching FTS entries are removed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import fs from 'fs';
import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';

let sqlite: Database;
let db: BunSQLiteDatabase<typeof schema>;
const TEST_DB_PATH = '/tmp/oracle-indexer-preservation-test.db';
const CURRENT = 'github.com/current/repo';

type DocInput = {
  id: string;
  createdBy: string | null;
  project: string | null;
  type?: string;
  sourceFile?: string;
  content?: string;
};

beforeAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  sqlite = new Database(TEST_DB_PATH);
  db = drizzle(sqlite, { schema });
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
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
      created_by TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );
    CREATE INDEX idx_type ON oracle_documents(type);
    CREATE INDEX idx_source ON oracle_documents(source_file);
    CREATE INDEX idx_project ON oracle_documents(project);
    CREATE INDEX idx_tenant ON oracle_documents(tenant_id);
    CREATE INDEX idx_created_by ON oracle_documents(created_by);
    CREATE INDEX idx_documents_usage_heat ON oracle_documents(usage_count, last_accessed_at);
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED, content, concepts, tokenize='porter unicode61'
    );
  `);
});

afterAll(() => {
  sqlite.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(() => {
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
});

function simulateSmartDeletion(project: string | null): string[] {
  const docsToDelete = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(
      project
        ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project))
        : isNull(oracleDocuments.project),
      or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
    ))
    .all();
  const idsToDelete = docsToDelete.map((doc) => doc.id);

  if (idsToDelete.length > 0) {
    db.delete(oracleDocuments).where(inArray(oracleDocuments.id, idsToDelete)).run();
    const placeholders = idsToDelete.map(() => '?').join(',');
    sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${placeholders})`).run(...idsToDelete);
  }
  return idsToDelete;
}

function insertTestDoc(doc: DocInput): void {
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id: doc.id,
    type: doc.type ?? 'learning',
    sourceFile: doc.sourceFile ?? `ψ/memory/learnings/${doc.id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: doc.createdBy,
    project: doc.project,
  }).run();
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(doc.id, doc.content ?? 'Test content', '');
}

function insertDocs(docs: DocInput[]): void {
  docs.forEach(insertTestDoc);
}

function expectDoc(id: string, exists = true): void {
  const doc = db.select().from(oracleDocuments).where(eq(oracleDocuments.id, id)).get();
  exists ? expect(doc).toBeDefined() : expect(doc).toBeUndefined();
}

const learning = (id: string, createdBy: string | null, project: string | null, extra: Partial<DocInput> = {}): DocInput => ({
  id,
  createdBy,
  project,
  ...extra,
});

describe('Indexer Preservation - oracle_learn documents', () => {
  it('preserves oracle_learn documents during re-index', () => {
    insertDocs([
      learning('test-oracle-learn-1', 'oracle_learn', 'github.com/other/repo'),
      learning('test-indexer-1', 'indexer', CURRENT),
    ]);

    const deleted = simulateSmartDeletion(CURRENT);

    expectDoc('test-oracle-learn-1');
    expectDoc('test-indexer-1', false);
    expect(deleted).toContain('test-indexer-1');
    expect(deleted).not.toContain('test-oracle-learn-1');
  });

  it('preserves oracle_learn docs from different projects', () => {
    insertDocs([
      learning('learn-repo-a', 'oracle_learn', 'github.com/team/repo-a'),
      learning('learn-repo-b', 'oracle_learn', 'github.com/team/repo-b'),
    ]);

    simulateSmartDeletion('github.com/team/repo-a');

    expectDoc('learn-repo-a');
    expectDoc('learn-repo-b');
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('deletes indexer docs from current project only', () => {
    insertDocs([
      learning('other-repo-doc', 'indexer', 'github.com/other/repo', { type: 'principle' }),
      learning('current-repo-doc', 'indexer', CURRENT, { type: 'principle' }),
    ]);

    const deleted = simulateSmartDeletion(CURRENT);

    expectDoc('other-repo-doc');
    expectDoc('current-repo-doc', false);
    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('deletes universal indexer docs but preserves universal oracle_learn docs', () => {
    insertDocs([
      learning('universal-indexer-doc', 'indexer', null, { type: 'principle' }),
      learning('project-specific-doc', 'indexer', CURRENT, { type: 'principle' }),
      learning('universal-learn-doc', 'oracle_learn', null),
    ]);

    const deleted = simulateSmartDeletion(CURRENT);

    expect(deleted).toEqual(expect.arrayContaining(['universal-indexer-doc', 'project-specific-doc']));
    expect(deleted).not.toContain('universal-learn-doc');
    expectDoc('universal-learn-doc');
  });
});

describe('Indexer Preservation - legacy and FTS behavior', () => {
  it('treats legacy docs with null createdBy as indexer-created', () => {
    insertTestDoc(learning('legacy-doc', null, CURRENT));

    const deleted = simulateSmartDeletion(CURRENT);

    expectDoc('legacy-doc', false);
    expect(deleted).toContain('legacy-doc');
  });

  it('deletes matching FTS rows and preserves FTS rows for preserved docs', () => {
    insertDocs([
      learning('fts-test-doc', 'indexer', CURRENT, { content: 'Searchable content for FTS test' }),
      learning('fts-preserved-doc', 'oracle_learn', 'github.com/other/repo', {
        content: 'This content should remain searchable',
      }),
    ]);
    expect(sqlite.prepare('SELECT id FROM oracle_fts WHERE id = ?').get('fts-test-doc')).toBeDefined();

    simulateSmartDeletion(CURRENT);

    expect(sqlite.prepare('SELECT id FROM oracle_fts WHERE id = ?').get('fts-test-doc')).toBeFalsy();
    const fts = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?')
      .get('fts-preserved-doc') as { content: string } | undefined;
    expect(fts?.content).toBe('This content should remain searchable');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('handles empty databases and oracle_learn-only databases without deletions', () => {
    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);

    insertDocs([
      learning('only-learn-1', 'oracle_learn', 'github.com/repo/1'),
      learning('only-learn-2', 'oracle_learn', 'github.com/repo/2'),
    ]);

    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
    expect(db.select().from(oracleDocuments).all()).toHaveLength(2);
  });

  it('handles mixed createdBy values correctly', () => {
    insertDocs([
      learning('indexer-doc', 'indexer', CURRENT),
      learning('oracle-learn-doc', 'oracle_learn', CURRENT),
      learning('manual-doc', 'manual', CURRENT),
      learning('legacy-doc', null, CURRENT),
    ]);

    const deleted = simulateSmartDeletion(CURRENT);
    const remainingIds = db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().map((doc) => doc.id);

    expect(deleted).toEqual(expect.arrayContaining(['indexer-doc', 'legacy-doc']));
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');
    expect(remainingIds).toEqual(expect.arrayContaining(['oracle-learn-doc', 'manual-doc']));
  });
});
