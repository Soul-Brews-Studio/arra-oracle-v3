import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDigest, documentStorageId } from '../document-identity.ts';
import { migrateDocumentIdentity } from './document-identity-migration.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createIdentityDatabase(path = ':memory:'): Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      display_id TEXT,
      content_digest TEXT,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL,
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
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function insertDocument(db: Database, id: string, project: string | null, supersededBy: string | null = null): void {
  db.prepare(`
    INSERT INTO oracle_documents (
      id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by, project
    ) VALUES (?, 'learning', ?, '[]', 1, 1, 1, ?, ?)
  `).run(id, `${id}.md`, supersededBy, project);
}

describe('document identity migration', () => {
  test('rekeys SQLite and FTS rows while preserving display IDs and supersession', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oracle-document-identity-'));
    tempDirs.push(dir);
    const path = join(dir, 'oracle.db');
    const first = createIdentityDatabase(path);
    insertDocument(first, 'legacy-a', 'My Second Brain V2', 'legacy-b');
    insertDocument(first, 'legacy-b', null);
    first.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run('legacy-a', 'old content', 'old');
    first.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run('legacy-a', 'latest content', 'latest');

    expect(migrateDocumentIdentity(first)).toBe(2);

    const projectA = 'github.com/mengazaa/my-second-brain-v2';
    const idA = documentStorageId(projectA, 'legacy-a');
    const idB = documentStorageId(null, 'legacy-b');
    expect(first.prepare(`
      SELECT id, display_id, content_digest, project, superseded_by
      FROM oracle_documents WHERE display_id = 'legacy-a'
    `).get()).toEqual({
      id: idA,
      display_id: 'legacy-a',
      content_digest: contentDigest('latest content'),
      project: projectA,
      superseded_by: idB,
    });
    expect(first.prepare('SELECT id, content, concepts FROM oracle_fts').all()).toEqual([
      { id: idA, content: 'latest content', concepts: 'latest' },
    ]);

    const second = new Database(path);
    expect(migrateDocumentIdentity(second)).toBe(0);
    expect(second.prepare('SELECT count(*) AS count FROM oracle_documents').get()).toEqual({ count: 2 });
    expect(second.prepare('SELECT count(*) AS count FROM oracle_fts').get()).toEqual({ count: 1 });
    second.close();
    first.close();
  });

  test('returns from the durable marker without reading FTS again', () => {
    const db = createIdentityDatabase();
    insertDocument(db, 'legacy', null);
    db.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run('legacy', 'content', 'concept');

    expect(migrateDocumentIdentity(db)).toBe(1);
    db.exec('DROP TABLE oracle_fts');
    expect(migrateDocumentIdentity(db)).toBe(0);
    db.close();
  });

  test('rolls back rather than merging duplicate canonical identities', () => {
    const db = createIdentityDatabase();
    insertDocument(db, 'old-a', 'My Second Brain V2');
    insertDocument(db, 'old-b', 'github.com/mengazaa/my-second-brain-v2');
    db.exec("UPDATE oracle_documents SET display_id = 'shared'");

    expect(() => migrateDocumentIdentity(db)).toThrow('Duplicate canonical document identity detected');
    expect(db.prepare('SELECT id FROM oracle_documents ORDER BY id').all()).toEqual([
      { id: 'old-a' },
      { id: 'old-b' },
    ]);
    db.close();
  });
});
