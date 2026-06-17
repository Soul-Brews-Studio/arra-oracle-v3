import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLearningMarkdown } from '../../learn/markdown.ts';
import { loadVectorIndexDocuments } from '../../routes/vector/indexer-source.ts';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-index-source-'));
const vaultRoot = path.join(tmpRoot, 'vault');
const emptyRoot = path.join(tmpRoot, 'empty');
const sqlitePath = path.join(tmpRoot, 'oracle.db');

function writeLearningFile() {
  const dir = path.join(vaultRoot, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-06-01_vector-source.md'), buildLearningMarkdown({
    id: 'learning_2026-06-01_vector-source-1',
    pattern: 'vector sidecar source of truth should replay vault markdown',
    title: 'Vector Source',
    concepts: ['vector', 'vault'],
    createdAt: new Date('2026-06-01T02:03:04.000Z'),
    project: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
  }));
}

function writeSqliteDb() {
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY, type TEXT, source_file TEXT,
      concepts TEXT, project TEXT, created_at INTEGER,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );
    CREATE TABLE oracle_fts (id TEXT, content TEXT);
  `);
  db.prepare(`
    INSERT INTO oracle_documents
      (id, type, source_file, concepts, project, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('sqlite-doc-1', 'learning', 'ψ/memory/learnings/sqlite.md', '["sqlite"]', null, 1);
  db.prepare('INSERT INTO oracle_fts (id, content) VALUES (?, ?)').run('sqlite-doc-1', 'sqlite fallback body');
  db.close();
}

describe('loadVectorIndexDocuments', () => {
  test('loads vector documents from vault markdown with stable oracle_learn identity', () => {
    writeLearningFile();
    const loaded = loadVectorIndexDocuments({ source: 'vault', repoRoot: vaultRoot, dbPath: sqlitePath });

    expect(loaded.source).toBe('vault');
    expect(loaded.repoRoot).toBe(vaultRoot);
    expect(loaded.docs).toHaveLength(1);
    expect(loaded.docs[0].id).toBe('learning_2026-06-01_vector-source-1');
    expect(loaded.docs[0].document).toContain('vector sidecar source of truth');
    expect(JSON.parse(String(loaded.docs[0].metadata.concepts))).toEqual(expect.arrayContaining(['vector', 'vault']));
    expect(loaded.docs[0].metadata.project).toBe('github.com/Soul-Brews-Studio/arra-oracle-v3');
  });

  test('auto mode falls back to SQLite when no vault markdown exists', () => {
    fs.mkdirSync(emptyRoot, { recursive: true });
    writeSqliteDb();
    const loaded = loadVectorIndexDocuments({ source: 'auto', repoRoot: emptyRoot, dbPath: sqlitePath });

    expect(loaded.source).toBe('sqlite');
    expect(loaded.docs).toHaveLength(1);
    expect(loaded.docs[0]).toMatchObject({
      id: 'sqlite-doc-1',
      document: 'sqlite fallback body',
      metadata: { type: 'learning', source_file: 'ψ/memory/learnings/sqlite.md', concepts: '["sqlite"]' },
    });
  });

  test('explicit vault mode refuses an empty vault instead of wiping vectors', () => {
    fs.mkdirSync(emptyRoot, { recursive: true });
    expect(() => loadVectorIndexDocuments({ source: 'vault', repoRoot: emptyRoot, dbPath: sqlitePath }))
      .toThrow(/found 0 vault documents/);
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
