import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-opt-in-search-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
const originalVectorEnabled = process.env.ORACLE_VECTOR_ENABLED;

process.env.ORACLE_DATA_DIR = path.join(tmpRoot, 'data');
process.env.ORACLE_DB_PATH = path.join(tmpRoot, 'data', 'oracle.db');
process.env.ORACLE_REPO_ROOT = tmpRoot;
delete process.env.ORACLE_VECTOR_ENABLED;

const dbModule = await import('../../db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { sqlite, closeDb, resetDefaultDatabaseForTests } = dbModule;
const { generateDefaultConfig, writeVectorConfig } = await import('../../vector/config.ts');
const { handleSearch } = await import('../handlers.ts');

sqlite.exec(`
  INSERT OR REPLACE INTO oracle_documents
    (id, type, source_file, concepts, created_at, updated_at, indexed_at, project, created_by)
  VALUES
    ('vector-opt-in-doc', 'learning', 'ψ/memory/learnings/vector-opt-in.md', '["semantic"]', 1, 1, 1, NULL, 'indexer')
`);
sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run('vector-opt-in-doc');
sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
  .run('vector-opt-in-doc', 'vector opt in disabled still returns FTS recall', 'semantic');

const cfg = generateDefaultConfig();
cfg.enabled = false;
cfg.collections['bge-m3'].adapter = 'qdrant';
cfg.collections['bge-m3'].qdrantUrl = 'http://127.0.0.1:9';
writeVectorConfig(cfg);

describe('handleSearch vector opt-in gate', () => {
  test('local hybrid/vector requests stay FTS-only until vector section is enabled', async () => {
    for (const mode of ['hybrid', 'vector'] as const) {
      const result = await handleSearch('opt in disabled', 'all', 5, 0, mode);
      expect(result.mode).toBe(mode);
      expect(result.vectorAvailable).toBe(false);
      expect(result.warning).toBeUndefined();
      expect(result.results.some(r => r.id === 'vector-opt-in-doc')).toBe(true);
    }
  });
});

afterAll(() => {
  try { closeDb(); } catch {}
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalDbPath !== undefined) process.env.ORACLE_DB_PATH = originalDbPath;
  else delete process.env.ORACLE_DB_PATH;
  if (originalRepoRoot !== undefined) process.env.ORACLE_REPO_ROOT = originalRepoRoot;
  else delete process.env.ORACLE_REPO_ROOT;
  if (originalVectorEnabled !== undefined) process.env.ORACLE_VECTOR_ENABLED = originalVectorEnabled;
  else delete process.env.ORACLE_VECTOR_ENABLED;
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
