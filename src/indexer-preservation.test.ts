import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import fs from 'fs';
import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';

let sqlite: Database;
let db: BunSQLiteDatabase<typeof schema>;
const TEST_DB_PATH = '/tmp/oracle-indexer-preservation-test.db';

const TEST_SCHEMA = `
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
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_by TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER
);
CREATE INDEX idx_type ON oracle_documents(type);
CREATE INDEX idx_source ON oracle_documents(source_file);
CREATE INDEX idx_project ON oracle_documents(project);
CREATE INDEX idx_tenant ON oracle_documents(tenant_id);
CREATE INDEX idx_created_by ON oracle_documents(created_by);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61');
`;

type TestDoc = {
  id: string;
  type: string;
  sourceFile: string;
  createdBy: string | null;
  project: string | null;
  content?: string;
};

beforeAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  sqlite = new Database(TEST_DB_PATH);
  db = drizzle(sqlite, { schema });
  sqlite.exec(TEST_SCHEMA);
});

afterAll(() => {
  sqlite.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(() => {
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
});

function insertTestDoc(doc: TestDoc) {
  const now = Date.now();
  db.insert(oracleDocuments).values({
    id: doc.id,
    type: doc.type,
    sourceFile: doc.sourceFile,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: doc.createdBy,
    project: doc.project,
  }).run();
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(doc.id, doc.content || 'Test content', '');
}

function simulateSmartDeletion(project: string | null): string[] {
  const docsToDelete = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(
      project ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project)) : isNull(oracleDocuments.project),
      or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
    ))
    .all();
  const ids = docsToDelete.map((doc) => doc.id);
  if (!ids.length) return ids;
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
  sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return ids;
}

function row(id: string) {
  return db.select().from(oracleDocuments).where(eq(oracleDocuments.id, id)).get();
}

function fts(id: string) {
  return sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').get(id) as { content: string } | undefined;
}

describe('Indexer Preservation - oracle_learn documents', () => {
  it('preserves oracle_learn documents during re-index', () => {
    insertTestDoc({ id: 'test-oracle-learn-1', type: 'learning', sourceFile: 'ψ/memory/learnings/test.md', createdBy: 'oracle_learn', project: 'github.com/other/repo' });
    insertTestDoc({ id: 'test-indexer-1', type: 'learning', sourceFile: 'ψ/memory/learnings/local.md', createdBy: 'indexer', project: 'github.com/current/repo' });
    const deleted = simulateSmartDeletion('github.com/current/repo');
    expect(row('test-oracle-learn-1')?.createdBy).toBe('oracle_learn');
    expect(row('test-indexer-1')).toBeUndefined();
    expect(deleted).toContain('test-indexer-1');
    expect(deleted).not.toContain('test-oracle-learn-1');
  });

  it('preserves oracle_learn docs from different projects', () => {
    insertTestDoc({ id: 'learn-repo-a', type: 'learning', sourceFile: 'ψ/memory/learnings/a.md', createdBy: 'oracle_learn', project: 'github.com/team/repo-a' });
    insertTestDoc({ id: 'learn-repo-b', type: 'learning', sourceFile: 'ψ/memory/learnings/b.md', createdBy: 'oracle_learn', project: 'github.com/team/repo-b' });
    simulateSmartDeletion('github.com/team/repo-a');
    expect(row('learn-repo-a')).toBeDefined();
    expect(row('learn-repo-b')).toBeDefined();
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('deletes indexer docs from current project only', () => {
    insertTestDoc({ id: 'other-repo-doc', type: 'principle', sourceFile: 'ψ/memory/resonance/other.md', createdBy: 'indexer', project: 'github.com/other/repo' });
    insertTestDoc({ id: 'current-repo-doc', type: 'principle', sourceFile: 'ψ/memory/resonance/current.md', createdBy: 'indexer', project: 'github.com/current/repo' });
    const deleted = simulateSmartDeletion('github.com/current/repo');
    expect(row('other-repo-doc')).toBeDefined();
    expect(row('current-repo-doc')).toBeUndefined();
    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('deletes universal indexer docs', () => {
    insertTestDoc({ id: 'universal-indexer-doc', type: 'principle', sourceFile: 'ψ/memory/resonance/universal.md', createdBy: 'indexer', project: null });
    insertTestDoc({ id: 'project-specific-doc', type: 'principle', sourceFile: 'ψ/memory/resonance/project.md', createdBy: 'indexer', project: 'github.com/current/repo' });
    const deleted = simulateSmartDeletion('github.com/current/repo');
    expect(deleted).toContain('universal-indexer-doc');
    expect(deleted).toContain('project-specific-doc');
  });

  it('preserves universal oracle_learn docs', () => {
    insertTestDoc({ id: 'universal-learn-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/universal.md', createdBy: 'oracle_learn', project: null });
    const deleted = simulateSmartDeletion('github.com/any/repo');
    expect(row('universal-learn-doc')).toBeDefined();
    expect(deleted).not.toContain('universal-learn-doc');
  });
});

describe('Indexer Preservation - legacy docs and FTS sync', () => {
  it('treats legacy docs as indexer-created', () => {
    insertTestDoc({ id: 'legacy-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/legacy.md', createdBy: null, project: 'github.com/current/repo' });
    const deleted = simulateSmartDeletion('github.com/current/repo');
    expect(row('legacy-doc')).toBeUndefined();
    expect(deleted).toContain('legacy-doc');
  });

  it('deletes from FTS table when deleting oracle_documents', () => {
    insertTestDoc({ id: 'fts-test-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/fts.md', createdBy: 'indexer', project: 'github.com/current/repo', content: 'Searchable content for FTS test' });
    expect(fts('fts-test-doc')).toBeDefined();
    simulateSmartDeletion('github.com/current/repo');
    expect(fts('fts-test-doc')).toBeFalsy();
  });

  it('preserves FTS entries for preserved documents', () => {
    insertTestDoc({ id: 'fts-preserved-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/preserved.md', createdBy: 'oracle_learn', project: 'github.com/other/repo', content: 'This content should remain searchable' });
    simulateSmartDeletion('github.com/current/repo');
    expect(fts('fts-preserved-doc')?.content).toBe('This content should remain searchable');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('handles empty database gracefully', () => {
    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
  });

  it('handles database with only oracle_learn docs', () => {
    insertTestDoc({ id: 'only-learn-1', type: 'learning', sourceFile: 'ψ/memory/learnings/1.md', createdBy: 'oracle_learn', project: 'github.com/repo/1' });
    insertTestDoc({ id: 'only-learn-2', type: 'learning', sourceFile: 'ψ/memory/learnings/2.md', createdBy: 'oracle_learn', project: 'github.com/repo/2' });
    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
    expect(db.select().from(oracleDocuments).all()).toHaveLength(2);
  });

  it('handles mixed createdBy values correctly', () => {
    insertTestDoc({ id: 'indexer-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/indexer.md', createdBy: 'indexer', project: 'github.com/current/repo' });
    insertTestDoc({ id: 'oracle-learn-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/learn.md', createdBy: 'oracle_learn', project: 'github.com/current/repo' });
    insertTestDoc({ id: 'manual-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/manual.md', createdBy: 'manual', project: 'github.com/current/repo' });
    insertTestDoc({ id: 'legacy-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/legacy.md', createdBy: null, project: 'github.com/current/repo' });
    const deleted = simulateSmartDeletion('github.com/current/repo');
    const remainingIds = db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().map((doc) => doc.id);
    expect(deleted).toContain('indexer-doc');
    expect(deleted).toContain('legacy-doc');
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');
    expect(remainingIds).toEqual(expect.arrayContaining(['oracle-learn-doc', 'manual-doc']));
  });
});
