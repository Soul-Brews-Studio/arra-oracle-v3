import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCorpusCoverage } from '../../../deploy/private/arra-full-stack/corpus-coverage.ts';

describe('private corpus source coverage', () => {
  test('maps every database source file to one curated snapshot entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-coverage-'));
    try {
      const dbPath = join(root, 'oracle.db'), snapshotPath = join(root, 'snapshot.json');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE oracle_documents (id TEXT, source_file TEXT); CREATE TABLE oracle_fts (id TEXT, content TEXT)');
      db.query('INSERT INTO oracle_documents (id, source_file) VALUES (?, ?)').run('one', 'docs/one.md');
      db.query('INSERT INTO oracle_documents (id, source_file) VALUES (?, ?)').run('two', './docs/two.md');
      db.query('INSERT INTO oracle_fts (id, content) VALUES (?, ?)').run('one', 'one content');
      db.query('INSERT INTO oracle_fts (id, content) VALUES (?, ?)').run('two', 'two content');
      db.close();
      writeFileSync(snapshotPath, JSON.stringify({ entries: [
        { source: 'repo', relativePath: 'docs/one.md', sha256: 'a', bytes: 1 },
        { source: 'arra', relativePath: 'docs/two.md', sha256: 'b', bytes: 2 },
      ] }));

      expect(verifyCorpusCoverage(dbPath, snapshotPath)).toMatchObject({
        uncovered: [], files: [
          { sourceFile: 'docs/one.md', source: 'repo' },
          { sourceFile: 'docs/two.md', source: 'arra' },
        ],
        documents: [
          { id: expect.any(String), sourceFile: 'docs/one.md', contentBytes: expect.any(Number) },
          { id: expect.any(String), sourceFile: 'docs/two.md', contentBytes: expect.any(Number) },
        ],
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('reports uncovered and ambiguous source paths instead of guessing', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-coverage-'));
    try {
      const dbPath = join(root, 'oracle.db'), snapshotPath = join(root, 'snapshot.json');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE oracle_documents (id TEXT, source_file TEXT); CREATE TABLE oracle_fts (id TEXT, content TEXT)');
      db.query('INSERT INTO oracle_documents (id, source_file) VALUES (?, ?)').run('missing', 'missing.md');
      db.query('INSERT INTO oracle_documents (id, source_file) VALUES (?, ?)').run('readme', 'README.md');
      db.close();
      writeFileSync(snapshotPath, JSON.stringify({ entries: [
        { source: 'repo', relativePath: 'README.md', sha256: 'a', bytes: 1 },
        { source: 'arra', relativePath: 'README.md', sha256: 'b', bytes: 2 },
      ] }));

      expect(verifyCorpusCoverage(dbPath, snapshotPath).uncovered).toEqual(['README.md', 'missing.md']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('maps official mine namespace back to its curated root-relative path', () => {
    const root = mkdtempSync(join(tmpdir(), 'arra-corpus-coverage-'));
    try {
      const dbPath = join(root, 'oracle.db'), snapshotPath = join(root, 'snapshot.json');
      const db = new Database(dbPath);
      db.exec('CREATE TABLE oracle_documents (id TEXT, source_file TEXT); CREATE TABLE oracle_fts (id TEXT, content TEXT)');
      db.query('INSERT INTO oracle_documents (id, source_file) VALUES (?, ?)').run('mine-one', 'mine/corpus/docs/one.md');
      db.query('INSERT INTO oracle_fts (id, content) VALUES (?, ?)').run('mine-one', 'one content');
      db.close();
      writeFileSync(snapshotPath, JSON.stringify({ entries: [
        { source: 'repo', relativePath: 'docs/one.md', sha256: 'a', bytes: 1 },
      ] }));

      expect(verifyCorpusCoverage(dbPath, snapshotPath).uncovered).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
