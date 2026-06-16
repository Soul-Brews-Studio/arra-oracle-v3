import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-search-fts-query-'));
const dataDir = path.join(tmpRoot, 'data');
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalVectorUrl = process.env.VECTOR_URL;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
delete process.env.VECTOR_URL;

const { sqlite } = await import('../../db/index.ts');
const { buildFtsQuery, handleSearch } = await import('../handlers.ts');
const { sanitizeFtsQuery } = await import('../../tools/search.ts');

function insertDoc(id: string, content: string, concepts: string[] = []) {
  const now = Date.now();
  sqlite.prepare(`
    INSERT OR REPLACE INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at, project, created_by)
    VALUES (?, 'learning', ?, ?, ?, ?, ?, NULL, 'test')
  `).run(id, `${id}.md`, JSON.stringify(concepts), now, now, now);
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, concepts.join(' '));
}

insertDoc('punctuation', 'Muninn recalls foo bar baz from punctuation-heavy notes.', ['muninn']);
insertDoc('alpha-only', 'Issue one three one four alphaonly recall lives here.', ['alphaonly1314']);
insertDoc('beta-only', 'Issue one three one four betaonly memory lives here.', ['betaonly1314']);
insertDoc('alpha-beta', 'Issue one three one four alphaonly and betaonly both appear here.', ['alphaonly1314', 'betaonly1314']);

describe('FTS query sanitation and recall behavior', () => {
  test('builds quoted OR terms instead of raw punctuation syntax', () => {
    expect(buildFtsQuery('foo.bar, baz (now)!')).toBe('"foo" OR "bar" OR "baz" OR "now"');
    expect(sanitizeFtsQuery('foo.bar, baz (now)!')).toBe('"foo" OR "bar" OR "baz" OR "now"');
  });

  test('punctuation-heavy FTS queries degrade gracefully instead of throwing', async () => {
    const result = await handleSearch('foo.bar, baz (now)!', 'all', 10, 0, 'fts');
    expect(result.results.map((r) => r.id)).toContain('punctuation');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test('natural-language multi-token recall uses OR semantics instead of implicit AND only', async () => {
    const result = await handleSearch('alphaonly1314 betaonly1314', 'all', 20, 0, 'fts');
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain('alpha-only');
    expect(ids).toContain('beta-only');
    expect(ids).toContain('alpha-beta');
  });
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath !== undefined) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalVectorUrl !== undefined) process.env.VECTOR_URL = originalVectorUrl;
  else delete process.env.VECTOR_URL;
});
