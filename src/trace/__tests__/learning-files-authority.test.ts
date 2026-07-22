import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const saved = Object.fromEntries(['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_REPO_ROOT', 'GHQ_ROOT']
  .map((key) => [key, process.env[key]]));
const root = join(tmpdir(), `arra-trace-learn-${Date.now()}`);
const vaultRoot = join(root, 'ghq/github.com/test/oracle-vault');
mkdirSync(vaultRoot, { recursive: true });
mkdirSync(join(vaultRoot, '.git'));
process.env.ORACLE_DATA_DIR = join(root, 'data');
process.env.ORACLE_DB_PATH = join(root, 'data/oracle.db');
process.env.ORACLE_REPO_ROOT = join(root, 'repo');
process.env.GHQ_ROOT = join(root, 'ghq');
const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
dbMod.setSetting('vault_repo', 'github.com/test/oracle-vault');
mock.module('../../vault/discovery.ts', () => ({ getVaultPsiRoot: () => ({ path: vaultRoot }) }));
const { processLearnings } = await import('../learning-files.ts');

beforeEach(() => {
  for (const table of ['indexing_jobs', 'learn_log', 'oracle_fts', 'oracle_documents']) dbMod.sqlite.run(`DELETE FROM ${table}`);
  rmSync(join(vaultRoot, 'github.com'), { recursive: true, force: true });
  rmSync(join(vaultRoot, '_universal'), { recursive: true, force: true });
});
afterAll(() => {
  dbMod.resetDefaultDatabaseForTests(':memory:');
  for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  rmSync(root, { recursive: true, force: true });
});

describe('trace learning file writer', () => {
  test('writes project-first canonical markdown while remaining file-only', () => {
    const [file] = processLearnings(['Trace file-only alignment'], 'github.com/acme/widgets', 'authority query');
    expect(file).toStartWith('github.com/acme/widgets/ψ/memory/learnings/');
    expect(existsSync(join(vaultRoot, file))).toBe(true);
    expect(dbMod.sqlite.query('SELECT id FROM oracle_documents').all()).toHaveLength(0);
    expect(dbMod.sqlite.query('SELECT id FROM oracle_fts').all()).toHaveLength(0);
    expect(dbMod.sqlite.query('SELECT id FROM learn_log').all()).toHaveLength(0);
    expect(dbMod.sqlite.query('SELECT id FROM indexing_jobs').all()).toHaveLength(0);
  });

  test('null authority uses universal path without unknown sentinel', () => {
    const [file] = processLearnings(['Trace universal alignment'], null, 'universal query');
    expect(file).toStartWith('_universal/ψ/memory/learnings/');
    const markdown = Bun.file(join(vaultRoot, file));
    expect(markdown.text()).resolves.not.toContain('project: unknown');
  });
});
