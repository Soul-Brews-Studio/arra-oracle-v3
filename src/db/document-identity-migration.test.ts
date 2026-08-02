import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentDigest, documentStorageId } from '../document-identity.ts';
import { migrateDocumentIdentity, migrateProvenanceIdentity } from './document-identity-migration.ts';

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

describe('provenance identity migration', () => {
  const createProvenanceDatabase = (): Database => {
    const db = createIdentityDatabase();
    db.exec(`
      CREATE TABLE learn_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        project TEXT
      );
      CREATE TABLE document_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        access_type TEXT,
        created_at INTEGER NOT NULL,
        project TEXT
      );
    `);
    return db;
  };

  test('remaps stale references to storage ids and is idempotent', () => {
    const db = createProvenanceDatabase();
    insertDocument(db, 'legacy-a', 'github.com/mengazaa/my-second-brain-v2');
    insertDocument(db, 'legacy-b', null);
    // Provenance logs captured the pre-migration id (== display_id), project unreliable.
    db.prepare('INSERT INTO learn_log (document_id, created_at, project) VALUES (?, 1, NULL)').run('legacy-a');
    db.prepare('INSERT INTO document_access (document_id, access_type, created_at, project) VALUES (?, ?, 1, NULL)')
      .run('legacy-b', 'search');

    expect(migrateDocumentIdentity(db)).toBe(2);
    expect(migrateProvenanceIdentity(db)).toBe(2);

    const idA = documentStorageId('github.com/mengazaa/my-second-brain-v2', 'legacy-a');
    const idB = documentStorageId(null, 'legacy-b');
    expect(db.prepare('SELECT document_id FROM learn_log').get()).toEqual({ document_id: idA });
    expect(db.prepare('SELECT document_id FROM document_access').get()).toEqual({ document_id: idB });
    // No dangling references remain.
    expect(db.prepare(`
      SELECT COUNT(*) AS dangling FROM learn_log l
      LEFT JOIN oracle_documents d ON d.id = l.document_id WHERE d.id IS NULL
    `).get()).toEqual({ dangling: 0 });

    expect(migrateProvenanceIdentity(db)).toBe(0);
    db.close();
  });

  test('leaves references untouched when the display id no longer resolves', () => {
    const db = createProvenanceDatabase();
    insertDocument(db, 'legacy-a', null);
    db.prepare('INSERT INTO learn_log (document_id, created_at, project) VALUES (?, 1, NULL)').run('deleted-doc');
    migrateDocumentIdentity(db);

    expect(migrateProvenanceIdentity(db)).toBe(0);
    expect(db.prepare('SELECT document_id FROM learn_log').get()).toEqual({ document_id: 'deleted-doc' });
    db.close();
  });
});

describe('migration journal', () => {
  test('keeps migration timestamps strictly increasing', async () => {
    const journal = await Bun.file(join(import.meta.dir, 'migrations/meta/_journal.json')).json();
    const timestamps = journal.entries.map((entry: { when: number }) => entry.when);
    expect(timestamps.every((timestamp: number, index: number) => index === 0 || timestamp > timestamps[index - 1])).toBe(true);
  });
});
