import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-health-source-'));
const dbPath = path.join(tmp, 'oracle.db');
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_DATA_DIR = tmp;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { sqlite } = createDatabase(dbPath);
const { buildVectorFreshness, readVectorSourceDocumentStats } = await import('../health.ts');

afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('vector health source eligibility', () => {
  test('counts only documents that the vector indexer can load through FTS', () => {
    sqlite.exec(`
      INSERT INTO oracle_documents
        (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
      VALUES
        ('eligible', 'default', 'learning', 'eligible.md', '[]', 1, 1, 10, 'indexer'),
        ('metadata-only', 'default', 'principle', 'oracle101.md', '[]', 1, 1, 20, 'zhuge');
      INSERT INTO oracle_fts (id, content) VALUES ('eligible', 'searchable body');
    `);

    const source = readVectorSourceDocumentStats(dbPath);
    expect(source).toEqual({ docs: 1, lastIndexed: '10' });
    expect(buildVectorFreshness([{ count: 1 }], source).status).toBe('fresh');
    expect(buildVectorFreshness([{ count: 2 }], source)).toMatchObject({
      status: 'stale',
      docsPending: 0,
      docsExtra: 1,
    });
  });
});
