/**
 * Indexer preservation tests: oracle_learn/manual docs survive re-index cleanup;
 * indexer/legacy rows and their FTS entries are removed for the active project.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';

let sqlite: Database;
let db: BunSQLiteDatabase<typeof schema>;

const SCHEMA = `
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
CREATE INDEX idx_project ON oracle_documents(project);
CREATE INDEX idx_created_by ON oracle_documents(created_by);
CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts, tokenize='porter unicode61');
`;

type TestDoc = {
  id: string;
  createdBy: string | null;
  project: string | null;
  type?: string;
  sourceFile?: string;
  content?: string;
};

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA);
  db = drizzle(sqlite, { schema });
});

afterEach(() => sqlite.close());

function simulateSmartDeletion(project: string | null): string[] {
  const rows = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(and(
      project ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project)) : isNull(oracleDocuments.project),
      or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
    ))
    .all();
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
  sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return ids;
}

function insertDoc(doc: TestDoc) {
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

function hasDoc(id: string): boolean {
  return Boolean(db.select({ id: oracleDocuments.id }).from(oracleDocuments)
    .where(eq(oracleDocuments.id, id)).get());
}

function ids(): string[] {
  return db.select({ id: oracleDocuments.id }).from(oracleDocuments).all().map((row) => row.id);
}

describe('Indexer Preservation - oracle_learn documents', () => {
  it('preserves oracle_learn docs and deletes current-project indexer docs', () => {
    insertDoc({ id: 'learn-1', createdBy: 'oracle_learn', project: 'github.com/other/repo' });
    insertDoc({ id: 'indexer-1', createdBy: 'indexer', project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(hasDoc('learn-1')).toBe(true);
    expect(hasDoc('indexer-1')).toBe(false);
    expect(deleted).toContain('indexer-1');
    expect(deleted).not.toContain('learn-1');
  });

  it('preserves oracle_learn docs from all projects', () => {
    insertDoc({ id: 'learn-repo-a', createdBy: 'oracle_learn', project: 'github.com/team/repo-a' });
    insertDoc({ id: 'learn-repo-b', createdBy: 'oracle_learn', project: 'github.com/team/repo-b' });

    expect(simulateSmartDeletion('github.com/team/repo-a')).toEqual([]);
    expect(ids()).toEqual(expect.arrayContaining(['learn-repo-a', 'learn-repo-b']));
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('deletes indexer docs from the current project only', () => {
    insertDoc({ id: 'other-repo-doc', createdBy: 'indexer', project: 'github.com/other/repo' });
    insertDoc({ id: 'current-repo-doc', createdBy: 'indexer', project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(hasDoc('other-repo-doc')).toBe(true);
    expect(hasDoc('current-repo-doc')).toBe(false);
    expect(deleted).toEqual(['current-repo-doc']);
  });

  it('deletes universal indexer docs but preserves universal oracle_learn docs', () => {
    insertDoc({ id: 'universal-indexer', createdBy: 'indexer', project: null });
    insertDoc({ id: 'project-indexer', createdBy: 'indexer', project: 'github.com/current/repo' });
    insertDoc({ id: 'universal-learn', createdBy: 'oracle_learn', project: null });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(deleted).toEqual(expect.arrayContaining(['universal-indexer', 'project-indexer']));
    expect(deleted).not.toContain('universal-learn');
    expect(hasDoc('universal-learn')).toBe(true);
  });
});

describe('Indexer Preservation - legacy docs and FTS sync', () => {
  it('treats null createdBy as indexer-created legacy data', () => {
    insertDoc({ id: 'legacy-doc', createdBy: null, project: 'github.com/current/repo' });

    expect(simulateSmartDeletion('github.com/current/repo')).toEqual(['legacy-doc']);
    expect(hasDoc('legacy-doc')).toBe(false);
  });

  it('deletes FTS rows for deleted docs and preserves FTS for retained docs', () => {
    insertDoc({ id: 'delete-fts', createdBy: 'indexer', project: 'github.com/current/repo', content: 'delete me' });
    insertDoc({ id: 'keep-fts', createdBy: 'oracle_learn', project: 'github.com/other/repo', content: 'keep me' });

    simulateSmartDeletion('github.com/current/repo');

    expect(sqlite.prepare('SELECT id FROM oracle_fts WHERE id = ?').get('delete-fts')).toBeFalsy();
    const kept = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').get('keep-fts') as { content: string };
    expect(kept.content).toBe('keep me');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('handles an empty database gracefully', () => {
    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
  });

  it('keeps databases that contain only oracle_learn docs', () => {
    insertDoc({ id: 'only-learn-1', createdBy: 'oracle_learn', project: 'github.com/repo/1' });
    insertDoc({ id: 'only-learn-2', createdBy: 'oracle_learn', project: 'github.com/repo/2' });

    expect(simulateSmartDeletion('github.com/any/repo')).toEqual([]);
    expect(ids()).toHaveLength(2);
  });

  it('handles mixed createdBy values correctly', () => {
    insertDoc({ id: 'indexer-doc', createdBy: 'indexer', project: 'github.com/current/repo' });
    insertDoc({ id: 'oracle-learn-doc', createdBy: 'oracle_learn', project: 'github.com/current/repo' });
    insertDoc({ id: 'manual-doc', createdBy: 'manual', project: 'github.com/current/repo' });
    insertDoc({ id: 'legacy-doc', createdBy: null, project: 'github.com/current/repo' });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(deleted).toEqual(expect.arrayContaining(['indexer-doc', 'legacy-doc']));
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');
    expect(ids()).toEqual(expect.arrayContaining(['oracle-learn-doc', 'manual-doc']));
  });
});
