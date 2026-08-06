import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-psi-fts-'));
const dataDir = path.join(tmp, 'data');
const repoRoot = path.join(tmp, 'vault-root');
const psiRoot = path.join(repoRoot, 'ψ');
const learningDir = path.join(psiRoot, 'memory', 'learnings');
fs.mkdirSync(learningDir, { recursive: true });
fs.writeFileSync(path.join(learningDir, '2026-06-07_psi-detect.md'), `---
tags: [psi-detect, onboarding]
---

ψ folder detection should feed FTS-only onboarding search without vector indexing.
`);

const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
delete process.env.ORACLE_REPO_ROOT;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { normalizeIndexerRepoRoot, runOracleReindex } = await import('../runner.ts');

describe('ψ-folder detection → FTS indexing', () => {
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

  test('normalizes an explicit ψ path to its repo root', () => {
    expect(normalizeIndexerRepoRoot(psiRoot)).toBe(repoRoot);
  });

  test('indexes an explicit ψ folder into SQLite FTS without vector setup', async () => {
    const result = await runOracleReindex({ repoRoot: psiRoot });
    expect(result.ok).toBe(true);
    expect(result.repoRoot).toBe(repoRoot);

    const { sqlite } = createDatabase(process.env.ORACLE_DB_PATH);
    try {
      const row = sqlite.prepare(`
        SELECT d.source_file, f.content
        FROM oracle_documents d
        JOIN oracle_fts f ON f.id = d.id
        WHERE oracle_fts MATCH 'onboarding'
        LIMIT 1
      `).get() as { source_file: string; content: string } | undefined;

      expect(row).toBeTruthy();
      expect(row?.source_file).toBe('ψ/memory/learnings/2026-06-07_psi-detect.md');
      expect(row?.content).toContain('FTS-only onboarding search');
    } finally {
      sqlite.close();
    }

    expect(fs.existsSync(path.join(dataDir, 'lancedb'))).toBe(false);
  });
});
