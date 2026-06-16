import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-append-reindex-'));
const dataDir = path.join(tmp, 'data');
const repoA = path.join(tmp, 'repo-a');
const repoB = path.join(tmp, 'repo-b');

function writeLearning(repoRoot: string, filename: string, body: string) {
  const dir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
}

writeLearning(repoA, 'a.md', '# repo a\n\nalpha append preservation');
writeLearning(repoB, 'b.md', '# repo b\n\nbeta append upsert');

const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
delete process.env.ORACLE_REPO_ROOT;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { runOracleReindex } = await import('../runner.ts');

describe('append reindex mode', () => {
  afterAll(() => {
    try { closeDb(); } catch {}
    if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
    else process.env.ORACLE_DATA_DIR = originalDataDir;
    if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
    else process.env.ORACLE_DB_PATH = originalDbPath;
    if (originalRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
    else process.env.ORACLE_REPO_ROOT = originalRepoRoot;
    resetDefaultDatabaseForTests(':memory:');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('upserts from a new repo root without deleting older indexed docs', async () => {
    const first = await runOracleReindex({ repoRoot: repoA });
    expect(first.ok).toBe(true);
    expect(first.append).toBe(false);

    const second = await runOracleReindex({ repoRoot: repoB, append: true });
    expect(second.ok).toBe(true);
    expect(second.append).toBe(true);

    const { sqlite } = createDatabase(process.env.ORACLE_DB_PATH);
    try {
      const rows = sqlite.prepare(`
        SELECT source_file AS sourceFile
        FROM oracle_documents
        WHERE source_file IN ('ψ/memory/learnings/a.md', 'ψ/memory/learnings/b.md')
        ORDER BY source_file
      `).all() as Array<{ sourceFile: string }>;

      expect(rows.map(r => r.sourceFile)).toEqual([
        'ψ/memory/learnings/a.md',
        'ψ/memory/learnings/b.md',
      ]);
    } finally {
      sqlite.close();
    }
  });
});
