import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const saved = Object.fromEntries(['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_REPO_ROOT']
  .map((key) => [key, process.env[key]]));
const root = join(tmpdir(), `arra-persist-learn-${Date.now()}`);
const repoRoot = join(root, 'repo');
const vaultRoot = join(root, 'vault');
mkdirSync(repoRoot, { recursive: true });
mkdirSync(vaultRoot, { recursive: true });
process.env.ORACLE_DATA_DIR = join(root, 'data');
process.env.ORACLE_DB_PATH = join(root, 'data/oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;

mock.module('../../vault/discovery.ts', () => ({ getVaultPsiRoot: () => ({ path: vaultRoot }) }));
const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { handleSessionSummary, persistLearningDoc } = await import('../handlers.ts');

beforeEach(() => {
  for (const table of ['learn_log', 'oracle_fts', 'oracle_documents']) dbMod.sqlite.run(`DELETE FROM ${table}`);
  rmSync(join(vaultRoot, 'github.com'), { recursive: true, force: true });
  rmSync(join(vaultRoot, '_universal'), { recursive: true, force: true });
  rmSync(join(repoRoot, 'ψ'), { recursive: true, force: true });
});
afterAll(() => {
  dbMod.resetDefaultDatabaseForTests(':memory:');
  for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  rmSync(root, { recursive: true, force: true });
});

describe('persistLearningDoc project-first learning gate', () => {
  test('learning subdir uses one project across file, DB, FTS, and log', () => {
    const project = 'github.com/acme/widgets';
    const result = persistLearningDoc({
      pattern: 'Persist seam alignment', subdir: 'ψ/memory/learnings',
      filename: '2026-07-22_persist-seam.md', id: 'learning_2026-07-22_persist-seam', project,
    });
    expect(result.file).toStartWith(`${project}/ψ/memory/learnings/`);
    expect(existsSync(join(vaultRoot, result.file))).toBe(true);
    const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, result.id)).get();
    const log = dbMod.db.select().from(dbMod.learnLog).where(eq(dbMod.learnLog.documentId, result.id)).get();
    expect(row?.project).toBe(project);
    expect(log?.project).toBe(project);
    expect(dbMod.sqlite.query('SELECT id FROM oracle_fts WHERE id = ?').get(result.id)).toBeTruthy();
  });

  test('malformed explicit project stops before all persistence effects', () => {
    expect(() => persistLearningDoc({
      pattern: 'blocked persist', subdir: 'ψ/memory/learnings', filename: 'blocked.md',
      id: 'learning_blocked', project: 'owner/repo',
    })).toThrow('Invalid project authority');
    expect(dbMod.sqlite.query('SELECT id FROM oracle_documents').all()).toHaveLength(0);
    expect(dbMod.sqlite.query('SELECT id FROM oracle_fts').all()).toHaveLength(0);
    expect(dbMod.sqlite.query('SELECT id FROM learn_log').all()).toHaveLength(0);
  });

  test('session summary remains projectless outside learnings', () => {
    const session = handleSessionSummary(`authority-${Date.now()}`, 'Session summary remains outside learnings.');
    expect(session.source_file).toStartWith('ψ/memory/session-summaries/');
    expect(existsSync(join(repoRoot, session.source_file))).toBe(true);
    expect(session.source_file).not.toContain('/learnings/');
    const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, session.learning_id)).get();
    expect(row?.project).toBeNull();
  });
});
