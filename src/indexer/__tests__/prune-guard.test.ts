import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-prune-guard-'));
const dataDir = path.join(tmp, 'data');
const repoA = path.join(tmp, 'repo-a');
const repoB = path.join(tmp, 'repo-b');
const repoC = path.join(tmp, 'repo-c');
const repoA2 = path.join(tmp, 'repo-a-renamed');

function writeLearning(repoRoot: string, filename: string, body: string) {
  const dir = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
}

writeLearning(repoA, 'a.md', '# repo a\n\nalpha prune guard survivor');
writeLearning(repoB, 'b.md', '# repo b\n\nbeta prune guard baseline');
writeLearning(repoC, 'c.md', '---\nproject: github.com/other/x\n---\n\n# repo c\n\ngamma frontmatter project override');

const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalRepoRoot = process.env.ORACLE_REPO_ROOT;
const originalForce = process.env.ORACLE_FORCE_REINDEX;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
delete process.env.ORACLE_REPO_ROOT;
delete process.env.ORACLE_FORCE_REINDEX;

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { runOracleReindex } = await import('../runner.ts');
const { buildDeletePlan, printDeletePlan, resolvePruneAuthority, sourcePrefix, CANONICAL_SOURCE_ROOT_KEY } = await import('../prune-authority.ts');
const { parseIndexerCliArgs } = await import('../cli.ts');

const A_SOURCE = 'ψ/memory/learnings/a.md';
const B_SOURCE = 'ψ/memory/learnings/b.md';
const C_SOURCE = 'ψ/memory/learnings/c.md';

function sourceFiles(): string[] {
  const { sqlite } = createDatabase(process.env.ORACLE_DB_PATH!);
  return (sqlite.prepare('SELECT DISTINCT source_file AS s FROM oracle_documents ORDER BY s').all() as Array<{ s: string }>).map(r => r.s);
}

function setCanonical(root: string | null) {
  const { sqlite } = createDatabase(process.env.ORACLE_DB_PATH!);
  sqlite.prepare('DELETE FROM settings WHERE key = ?').run(CANONICAL_SOURCE_ROOT_KEY);
  if (root !== null) {
    sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0)').run(CANONICAL_SOURCE_ROOT_KEY, root);
  }
}

describe('smart-delete prune guard (real OracleIndexer, temp DB)', () => {
  afterAll(() => {
    try { closeDb(); } catch {}
    if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
    else process.env.ORACLE_DATA_DIR = originalDataDir;
    if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
    else process.env.ORACLE_DB_PATH = originalDbPath;
    if (originalRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
    else process.env.ORACLE_REPO_ROOT = originalRepoRoot;
    if (originalForce === undefined) delete process.env.ORACLE_FORCE_REINDEX;
    else process.env.ORACLE_FORCE_REINDEX = originalForce;
    resetDefaultDatabaseForTests(':memory:');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('cross-project: full reindex from a narrowed root deletes nothing', async () => {
    expect((await runOracleReindex({ repoRoot: repoA })).ok).toBe(true);
    expect((await runOracleReindex({ repoRoot: repoB })).ok).toBe(true);
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE]);
  });

  test('ORACLE_FORCE_REINDEX=1 does not re-enable deletion', async () => {
    process.env.ORACLE_FORCE_REINDEX = '1';
    try {
      expect((await runOracleReindex({ repoRoot: repoB })).ok).toBe(true);
    } finally {
      delete process.env.ORACLE_FORCE_REINDEX;
    }
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE]);
  });

  test('NULL-project rows survive even a canonical + exact-count run', async () => {
    setCanonical(repoB);
    try {
      // a.md was indexed from a temp root with no detectable project => NULL bucket
      expect((await runOracleReindex({ repoRoot: repoB, confirmDelete: 1 })).ok).toBe(true);
    } finally {
      setCanonical(null);
    }
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE]);
  });

  test('frontmatter doc.project override rows survive a differently-scoped run', async () => {
    expect((await runOracleReindex({ repoRoot: repoC })).ok).toBe(true);
    expect((await runOracleReindex({ repoRoot: repoB })).ok).toBe(true);
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE, C_SOURCE]);
  });

  test('same-project alternate worktree (renamed checkout) deletes nothing', async () => {
    fs.cpSync(repoA, repoA2, { recursive: true });
    expect((await runOracleReindex({ repoRoot: repoA2 })).ok).toBe(true);
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE, C_SOURCE]);
  });

  test('exact-count mismatch is refused even with canonical + non-NULL plan', async () => {
    const { sqlite } = createDatabase(process.env.ORACLE_DB_PATH!);
    sqlite.prepare('UPDATE oracle_documents SET project = ? WHERE project IS NULL').run('github.com/other/x');
    setCanonical(repoB);
    try {
      expect((await runOracleReindex({ repoRoot: repoB, confirmDelete: 999 })).ok).toBe(true);
    } finally {
      setCanonical(null);
    }
    expect(sourceFiles()).toEqual([A_SOURCE, B_SOURCE, C_SOURCE]);
  });
});

describe('resolvePruneAuthority unit gates (fail-closed)', () => {
  const unit = new Database(':memory:');
  unit.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL)');
  const unitTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-prune-unit-'));
  const psiRoot = path.join(unitTmp, 'unit-root');
  fs.mkdirSync(path.join(psiRoot, 'ψ', 'memory'), { recursive: true });
  afterAll(() => fs.rmSync(unitTmp, { recursive: true, force: true }));
  const taggedPlan = () => buildDeletePlan([{ id: 'x', sourceFile: 'ψ/memory/learnings/x.md', project: 'github.com/other/x' }]);

  function withCanonical(value: string, fn: () => void) {
    unit.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 0)').run(CANONICAL_SOURCE_ROOT_KEY, value);
    try { fn(); } finally { unit.prepare('DELETE FROM settings WHERE key = ?').run(CANONICAL_SOURCE_ROOT_KEY); }
  }

  test('no canonical configured denies', () => {
    const auth = resolvePruneAuthority({ sqlite: unit, repoRoot: psiRoot, confirmDelete: 1, plan: taggedPlan() });
    expect(auth.granted).toBe(false);
    expect(auth.reason).toContain('no canonical_source_root');
  });

  test('unresolvable canonical and repoRoot both deny — null never equals null into a grant', () => {
    withCanonical(path.join(unitTmp, 'missing-canonical'), () => {
      const auth = resolvePruneAuthority({ sqlite: unit, repoRoot: path.join(unitTmp, 'missing-repo'), confirmDelete: 1, plan: taggedPlan() });
      expect(auth.granted).toBe(false);
      expect(auth.reason).toContain('does not resolve');
    });
  });

  test('non-canonical repoRoot denies', () => {
    withCanonical(psiRoot, () => {
      const auth = resolvePruneAuthority({ sqlite: unit, repoRoot: unitTmp, confirmDelete: 1, plan: taggedPlan() });
      expect(auth.granted).toBe(false);
      expect(auth.reason).toContain('not the canonical source root');
    });
  });

  test('NULL-project plan denies before count check', () => {
    withCanonical(psiRoot, () => {
      const plan = buildDeletePlan([{ id: 'n', sourceFile: 'ψ/memory/learnings/n.md', project: null }]);
      const auth = resolvePruneAuthority({ sqlite: unit, repoRoot: psiRoot, confirmDelete: 1, plan });
      expect(auth.granted).toBe(false);
      expect(auth.reason).toContain('NULL-project');
    });
  });

  test('undefined and mismatched confirmDelete deny; exact count grants', () => {
    withCanonical(psiRoot, () => {
      const plan = taggedPlan();
      expect(resolvePruneAuthority({ sqlite: unit, repoRoot: psiRoot, confirmDelete: undefined, plan }).granted).toBe(false);
      expect(resolvePruneAuthority({ sqlite: unit, repoRoot: psiRoot, confirmDelete: 2, plan }).granted).toBe(false);
      expect(resolvePruneAuthority({ sqlite: unit, repoRoot: psiRoot, confirmDelete: 1, plan }).granted).toBe(true);
    });
  });
});

describe('delete plan breakdowns', () => {
  const rows = [
    { id: '1', sourceFile: 'ψ/memory/retrospectives/2026-04/x.md', project: null },
    { id: '2', sourceFile: 'ψ/memory/retrospectives/2026-05/y.md', project: 'github.com/other/x' },
    { id: '3', sourceFile: 'ψ/memory/learnings/z.md', project: 'github.com/other/x' },
    { id: '4', sourceFile: 'top-level.md', project: null },
  ];

  test('sourcePrefix normalizes to first 3 components with safe fallback', () => {
    expect(sourcePrefix('ψ/memory/retrospectives/2026-04/x.md')).toBe('ψ/memory/retrospectives');
    expect(sourcePrefix('ψ/memory/learnings/z.md')).toBe('ψ/memory/learnings');
    expect(sourcePrefix('top-level.md')).toBe('top-level.md');
    expect(sourcePrefix('')).toBe('(unknown)');
  });

  test('buildDeletePlan aggregates byProject and bySourcePrefix', () => {
    const plan = buildDeletePlan(rows);
    expect(plan.hasNullProject).toBe(true);
    expect(Object.fromEntries(plan.byProject)).toEqual({ '(null)': 2, 'github.com/other/x': 2 });
    expect(Object.fromEntries(plan.bySourcePrefix)).toEqual({
      'ψ/memory/retrospectives': 2,
      'ψ/memory/learnings': 1,
      'top-level.md': 1,
    });
  });

  test('printDeletePlan emits both project and source-prefix breakdowns', () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => { lines.push(String(msg)); };
    try {
      printDeletePlan(buildDeletePlan(rows));
    } finally {
      console.log = originalLog;
    }
    const output = lines.join('\n');
    expect(output).toContain('4 stale candidate(s) by project:');
    expect(output).toContain('(null): 2');
    expect(output).toContain('by source prefix:');
    expect(output).toContain('ψ/memory/retrospectives: 2');
    expect(output).toContain('ψ/memory/learnings: 1');
  });
});

describe('cli --confirm-delete parsing', () => {
  test('accepts both --confirm-delete N and --confirm-delete=N', () => {
    expect(parseIndexerCliArgs(['--confirm-delete', '12']).confirmDelete).toBe(12);
    expect(parseIndexerCliArgs(['--confirm-delete=0']).confirmDelete).toBe(0);
  });

  test('defaults to undefined when flag absent', () => {
    expect(parseIndexerCliArgs([]).confirmDelete).toBeUndefined();
  });

  test('rejects missing, negative, and non-integer values', () => {
    expect(() => parseIndexerCliArgs(['--confirm-delete'])).toThrow('non-negative integer');
    expect(() => parseIndexerCliArgs(['--confirm-delete=-3'])).toThrow('non-negative integer');
    expect(() => parseIndexerCliArgs(['--confirm-delete=1.5'])).toThrow('non-negative integer');
    expect(() => parseIndexerCliArgs(['--confirm-delete=abc'])).toThrow('non-negative integer');
  });
});
