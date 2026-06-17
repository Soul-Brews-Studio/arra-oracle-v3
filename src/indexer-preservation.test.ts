import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';

type Db = BunSQLiteDatabase<typeof schema>;
type CreatedBy = 'indexer' | 'oracle_learn' | 'manual' | null;

let sqlite: Database;
let db: Db;

beforeAll(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  sqlite.exec(`
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
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED, content, concepts, tokenize='porter unicode61'
    );
  `);
});

afterAll(() => sqlite.close());

beforeEach(() => {
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
});

function simulateSmartDeletion(project: string | null): string[] {
  const docs = db.select({ id: oracleDocuments.id }).from(oracleDocuments)
    .where(and(
      project
        ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project))
        : isNull(oracleDocuments.project),
      or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
    )).all();
  const ids = docs.map((doc) => doc.id);
  if (!ids.length) return ids;

  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
  sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return ids;
}

function insertDoc(doc: {
  id: string;
  createdBy: CreatedBy;
  project: string | null;
  type?: string;
  sourceFile?: string;
  content?: string;
}): void {
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

const doc = (id: string) => db.select().from(oracleDocuments)
  .where(eq(oracleDocuments.id, id)).get();
const fts = (id: string) => sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?')
  .get(id) as { content: string } | undefined;

describe('Indexer Preservation - oracle_learn documents', () => {
  it('preserves oracle_learn documents during re-index', () => {
    insertDoc({ id: 'learn-1', createdBy: 'oracle_learn', project: 'github.com/other/repo' });
    insertDoc({ id: 'indexer-1', createdBy: 'indexer', project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(doc('learn-1')?.createdBy).toBe('oracle_learn');
    expect(doc('indexer-1')).toBeUndefined();
    expect(deleted).toContain('indexer-1');
    expect(deleted).not.toContain('learn-1');
  });

  it('preserves oracle_learn docs from different projects', () => {
    insertDoc({ id: 'learn-a', createdBy: 'oracle_learn', project: 'github.com/team/repo-a' });
    insertDoc({ id: 'learn-b', createdBy: 'oracle_learn', project: 'github.com/team/repo-b' });

    simulateSmartDeletion('github.com/team/repo-a');

    expect(doc('learn-a')).toBeDefined();
    expect(doc('learn-b')).toBeDefined();
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('deletes indexer docs from current project only', () => {
    insertDoc({ id: 'other-repo-doc', createdBy: 'indexer', project: 'github.com/other/repo' });
    insertDoc({ id: 'current-repo-doc', createdBy: 'indexer', project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(doc('other-repo-doc')).toBeDefined();
    expect(doc('current-repo-doc')).toBeUndefined();
    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('deletes universal indexer docs', () => {
    insertDoc({ id: 'universal-indexer-doc', createdBy: 'indexer', project: null });
    insertDoc({ id: 'project-specific-doc', createdBy: 'indexer', project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(deleted).toContain('universal-indexer-doc');
    expect(deleted).toContain('project-specific-doc');
  });

  it('preserves universal oracle_learn docs', () => {
    insertDoc({ id: 'universal-learn-doc', createdBy: 'oracle_learn', project: null });

    const deleted = simulateSmartDeletion('github.com/any/repo');

    expect(doc('universal-learn-doc')).toBeDefined();
    expect(deleted).not.toContain('universal-learn-doc');
  });
});

describe('Indexer Preservation - legacy docs', () => {
  it('treats null createdBy as indexer-created', () => {
    insertDoc({ id: 'legacy-doc', createdBy: null, project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(doc('legacy-doc')).toBeUndefined();
    expect(deleted).toContain('legacy-doc');
  });
});

describe('Indexer Preservation - FTS sync', () => {
  it('deletes from FTS when deleting from oracle_documents', () => {
    insertDoc({
      id: 'fts-test-doc',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
      content: 'Searchable content for FTS test',
    });

    expect(fts('fts-test-doc')).toBeDefined();
    simulateSmartDeletion('github.com/current/repo');
    expect(fts('fts-test-doc')).toBeFalsy();
  });

  it('preserves FTS entries for preserved documents', () => {
    insertDoc({
      id: 'fts-preserved-doc',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
      content: 'This content should remain searchable',
    });

    simulateSmartDeletion('github.com/current/repo');

    expect(fts('fts-preserved-doc')?.content).toBe('This content should remain searchable');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('handles empty database gracefully', () => {
    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
  });

  it('handles database with only oracle_learn docs', () => {
    insertDoc({ id: 'only-learn-1', createdBy: 'oracle_learn', project: 'github.com/repo/1' });
    insertDoc({ id: 'only-learn-2', createdBy: 'oracle_learn', project: 'github.com/repo/2' });

    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
    expect(db.select().from(oracleDocuments).all()).toHaveLength(2);
  });

  it('handles mixed createdBy values correctly', () => {
    insertDoc({ id: 'indexer-doc', createdBy: 'indexer', project: 'github.com/current/repo' });
    insertDoc({ id: 'oracle-learn-doc', createdBy: 'oracle_learn', project: 'github.com/current/repo' });
    insertDoc({ id: 'manual-doc', createdBy: 'manual', project: 'github.com/current/repo' });
    insertDoc({ id: 'legacy-doc', createdBy: null, project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');
    const remainingIds = db.select({ id: oracleDocuments.id }).from(oracleDocuments).all()
      .map((row) => row.id);

    expect(deleted).toContain('indexer-doc');
    expect(deleted).toContain('legacy-doc');
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');
    expect(remainingIds).toContain('oracle-learn-doc');
    expect(remainingIds).toContain('manual-doc');
  });
});
