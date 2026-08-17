import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-main-indexer-tenant-'));
const dataDir = path.join(tmp, 'data');
const dbPath = path.join(dataDir, 'oracle.db');
const repoRoot = path.join(tmp, 'repo');
const sourceFile = 'ψ/memory/learnings/default-tenant.md';

fs.mkdirSync(path.join(repoRoot, 'ψ', 'memory', 'learnings'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, sourceFile), '# Default tenant\n\ncurrent indexed body\n');
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = dbPath;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { runOracleReindex } = await import('../runner.ts');

afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('main indexer tenant boundary', () => {
  test('ambient-less indexing supersedes only default-tenant history', async () => {
    const { sqlite } = createDatabase(dbPath);
    sqlite.prepare(`INSERT INTO oracle_documents
      (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, created_by)
      VALUES ('legacy-default', 'default', 'learning', ?, '[]', 1, 1, 1, 'indexer'),
             ('legacy-b', 'tenant-b', 'learning', ?, '[]', 1, 1, 1, 'indexer')`)
      .run(sourceFile, sourceFile);

    await runOracleReindex({ repoRoot, append: true });

    const defaultRow = sqlite.prepare("SELECT superseded_by AS successor FROM oracle_documents WHERE id = 'legacy-default'")
      .get() as { successor: string | null };
    const tenantBRow = sqlite.prepare("SELECT superseded_by AS successor FROM oracle_documents WHERE id = 'legacy-b'")
      .get() as { successor: string | null };
    expect(defaultRow.successor).not.toBeNull();
    expect(tenantBRow.successor).toBeNull();
  });
});
