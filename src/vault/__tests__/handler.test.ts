/**
 * Unit tests for vault handler.
 *
 * Tests parseGitStatus, mapToVaultPath, mapFromVaultPath,
 * ensureFrontmatterProject, and syncVault dry-run behavior.
 */

import { afterAll, beforeAll, describe, it, expect, mock } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync as realExecSync } from 'child_process';

let fakeVaultPath: string | null = null;
const settings = new Map<string, string | null>();
const previousOracleDataDir = process.env.ORACLE_DATA_DIR;
const testOracleDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-data-'));
process.env.ORACLE_DATA_DIR = testOracleDataDir;

mock.module('../../db/index.ts', () => ({
  getSetting: (key: string) => settings.get(key) ?? null,
  setSetting: (key: string, value: string | null) => { settings.set(key, value); },
}));

mock.module('../discovery.ts', () => {
  function walkFiles(dir: string, baseDir: string): Array<{ relativePath: string; fullPath: string }> {
    const results: Array<{ relativePath: string; fullPath: string }> = [];
    if (!fs.existsSync(dir)) return results;

    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        results.push(...walkFiles(fullPath, baseDir));
      } else {
        results.push({ relativePath: path.relative(baseDir, fullPath), fullPath });
      }
    }
    return results;
  }

  function cleanEmptyDirs(dir: string, stopAt: string): void {
    if (dir === stopAt || !fs.existsSync(dir)) return;
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      cleanEmptyDirs(path.dirname(dir), stopAt);
    }
  }

  return {
    walkFiles,
    cleanEmptyDirs,
    resolveVaultPath: () => {
      if (!fakeVaultPath) throw new Error('fake vault path not set');
      return fakeVaultPath;
    },
    getVaultPsiRoot: () => ({ path: fakeVaultPath ?? '' }),
  };
});

let parseGitStatus: typeof import('../handler.ts').parseGitStatus;
let mapToVaultPath: typeof import('../handler.ts').mapToVaultPath;
let mapFromVaultPath: typeof import('../handler.ts').mapFromVaultPath;
let ensureFrontmatterProject: typeof import('../handler.ts').ensureFrontmatterProject;
let syncVault: typeof import('../handler.ts').syncVault;

beforeAll(async () => {
  ({ parseGitStatus, mapToVaultPath, mapFromVaultPath, ensureFrontmatterProject, syncVault } = await import('../handler.ts'));
});

afterAll(() => {
  if (previousOracleDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousOracleDataDir;
  fs.rmSync(testOracleDataDir, { recursive: true, force: true });
});

function setupSyncVaultFixture(prefix: string): {
  tmp: string;
  vaultPath: string;
  repoRoot: string;
  vaultProjectPsi: string;
  restore: () => void;
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previousVaultRepo = settings.get('vault_repo') ?? null;
  const vaultPath = path.join(tmp, 'oracle-vault');
  const remotePath = path.join(tmp, 'oracle-vault.git');
  const repoRoot = path.join(tmp, 'github.com', 'acme', 'app');
  const localPsi = path.join(repoRoot, 'ψ', 'memory', 'learnings');
  const vaultProjectPsi = path.join(vaultPath, 'github.com', 'acme', 'app', 'ψ', 'memory', 'learnings');

  fs.mkdirSync(localPsi, { recursive: true });
  fs.mkdirSync(vaultProjectPsi, { recursive: true });
  fakeVaultPath = vaultPath;

  fs.writeFileSync(path.join(localPsi, 'new.md'), '# new\n');
  fs.writeFileSync(path.join(localPsi, 'changed.md'), '# changed local\n');

  fs.writeFileSync(path.join(vaultProjectPsi, 'changed.md'), '---\nproject: github.com/acme/app\n---\n\n# changed old\n');
  fs.writeFileSync(path.join(vaultProjectPsi, 'deleted.md'), '# deleted\n');

  realExecSync('git init', { cwd: vaultPath, stdio: 'pipe' });
  realExecSync('git config user.email test@example.com', { cwd: vaultPath, stdio: 'pipe' });
  realExecSync('git config user.name Test', { cwd: vaultPath, stdio: 'pipe' });
  realExecSync('git add -A && git commit -m initial', { cwd: vaultPath, stdio: 'pipe' });
  realExecSync(`git init --bare "${remotePath}"`, { stdio: 'pipe' });
  realExecSync(`git remote add origin "${remotePath}"`, { cwd: vaultPath, stdio: 'pipe' });
  realExecSync('git push -u origin HEAD', { cwd: vaultPath, stdio: 'pipe' });

  settings.set('vault_repo', 'test/oracle-vault');

  return {
    tmp,
    vaultPath,
    repoRoot,
    vaultProjectPsi,
    restore: () => {
      fakeVaultPath = null;
      settings.set('vault_repo', previousVaultRepo);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

// ============================================================================
// parseGitStatus
// ============================================================================

describe('parseGitStatus', () => {
  it('returns zeros for empty output', () => {
    expect(parseGitStatus('')).toEqual({ added: 0, modified: 0, deleted: 0 });
    expect(parseGitStatus('  \n  ')).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it('counts untracked files as added', () => {
    const status = '?? ψ/memory/new-file.md\n?? ψ/memory/another.md';
    expect(parseGitStatus(status)).toEqual({ added: 2, modified: 0, deleted: 0 });
  });

  it('counts staged additions as added', () => {
    const status = 'A  ψ/memory/new-file.md';
    expect(parseGitStatus(status)).toEqual({ added: 1, modified: 0, deleted: 0 });
  });

  it('counts deletions', () => {
    const status = ' D ψ/memory/old-file.md\n D ψ/memory/gone.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 0, deleted: 2 });
  });

  it('counts modifications', () => {
    const status = ' M ψ/memory/changed.md\nM  ψ/memory/also-changed.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 2, deleted: 0 });
  });

  it('counts renames as modified', () => {
    const status = 'R  ψ/old-name.md -> ψ/new-name.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 1, deleted: 0 });
  });

  it('counts copies as added and type changes as modified', () => {
    const status = 'C  ψ/source.md -> ψ/copy.md\nT  ψ/memory/link.md';
    expect(parseGitStatus(status)).toEqual({ added: 1, modified: 1, deleted: 0 });
  });

  it('handles mixed status output', () => {
    const status = [
      '?? ψ/memory/new.md',
      'A  ψ/memory/staged-new.md',
      ' M ψ/memory/changed.md',
      ' D ψ/memory/removed.md',
      'R  ψ/old.md -> ψ/renamed.md',
    ].join('\n');

    expect(parseGitStatus(status)).toEqual({ added: 2, modified: 2, deleted: 1 });
  });

  it('handles staged deletions (D in index column)', () => {
    const status = 'D  ψ/memory/deleted.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 0, deleted: 1 });
  });
});

// ============================================================================
// mapToVaultPath
// ============================================================================

describe('mapToVaultPath', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('prefixes learnings with project', () => {
    expect(mapToVaultPath('ψ/memory/learnings/file.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/file.md');
  });

  it('prefixes retrospectives with project', () => {
    expect(mapToVaultPath('ψ/memory/retrospectives/2026-01/15/session.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/retrospectives/2026-01/15/session.md');
  });

  it('prefixes inbox/handoff with project', () => {
    expect(mapToVaultPath('ψ/inbox/handoff/context.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/inbox/handoff/context.md');
  });

  it('keeps resonance universal (no project prefix)', () => {
    expect(mapToVaultPath('ψ/memory/resonance/philosophy.md', project))
      .toBe('ψ/memory/resonance/philosophy.md');
  });

  it('returns path unchanged when project is null', () => {
    expect(mapToVaultPath('ψ/memory/learnings/file.md', null))
      .toBe('ψ/memory/learnings/file.md');
  });

  it('handles nested learning files', () => {
    expect(mapToVaultPath('ψ/memory/learnings/deep/nested/file.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/deep/nested/file.md');
  });
});

// ============================================================================
// mapFromVaultPath
// ============================================================================

describe('mapFromVaultPath', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('strips project prefix from learnings path', () => {
    expect(mapFromVaultPath(
      'github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/file.md',
      project
    )).toBe('ψ/memory/learnings/file.md');
  });

  it('strips project prefix from retrospectives path', () => {
    expect(mapFromVaultPath(
      'github.com/soul-brews-studio/oracle-v2/ψ/memory/retrospectives/2026-01/15/session.md',
      project
    )).toBe('ψ/memory/retrospectives/2026-01/15/session.md');
  });

  it('keeps resonance path as-is', () => {
    expect(mapFromVaultPath('ψ/memory/resonance/philosophy.md', project))
      .toBe('ψ/memory/resonance/philosophy.md');
  });

  it('returns null for unrecognized paths', () => {
    expect(mapFromVaultPath('some/random/path.md', project)).toBeNull();
  });

  it('returns null for different project paths', () => {
    expect(mapFromVaultPath(
      'github.com/other-org/other-repo/ψ/memory/learnings/file.md',
      project
    )).toBeNull();
  });
});

// ============================================================================
// ensureFrontmatterProject
// ============================================================================

describe('ensureFrontmatterProject', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('adds frontmatter when none exists', () => {
    const content = '# My Learning\n\nSome content here.';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toBe(
      `---\nproject: ${project}\n---\n\n# My Learning\n\nSome content here.`
    );
  });

  it('injects project into existing frontmatter', () => {
    const content = '---\ntags: [git, safety]\nsource: Oracle Learn\n---\n\n# Content';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toContain(`project: ${project}`);
    expect(result).toContain('tags: [git, safety]');
    expect(result).toContain('source: Oracle Learn');
  });

  it('injects project into CRLF frontmatter without duplicating fences', () => {
    const content = '---\r\ntags: [git, safety]\r\n---\r\n\r\n# Content';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toContain(`project: ${project}`);
    expect(result.startsWith('---\r\n')).toBe(true);
    expect(result.match(/^---/gm)?.length).toBe(2);
  });

  it('does not modify if project already exists', () => {
    const content = `---\nproject: ${project}\ntags: [test]\n---\n\n# Content`;
    const result = ensureFrontmatterProject(content, project);
    expect(result).toBe(content);
  });

  it('preserves existing project field even if different', () => {
    const content = '---\nproject: github.com/other/repo\n---\n\n# Content';
    const result = ensureFrontmatterProject(content, project);
    // Should NOT modify — project field already exists
    expect(result).toBe(content);
  });
});

// ============================================================================
// syncVault dry-run
// ============================================================================

describe('syncVault dry-run', () => {
  it('plans add/modify/delete without mutating the vault git worktree', () => {
    const { vaultPath, repoRoot, vaultProjectPsi, restore } = setupSyncVaultFixture('oracle-vault-dryrun-');

    try {
      const result = syncVault({ dryRun: true, repoRoot });
      expect(result).toEqual({
        dryRun: true,
        added: 1,
        modified: 1,
        deleted: 1,
        project: 'github.com/acme/app',
      });

      expect(realExecSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim()).toBe('');
      expect(fs.existsSync(path.join(vaultProjectPsi, 'new.md'))).toBe(false);
      expect(fs.readFileSync(path.join(vaultProjectPsi, 'changed.md'), 'utf-8')).toContain('# changed old');
      expect(fs.existsSync(path.join(vaultProjectPsi, 'deleted.md'))).toBe(true);
    } finally {
      restore();
    }
  });

  it('write-run applies add/modify/delete and reports the same counts', () => {
    const { vaultPath, repoRoot, vaultProjectPsi, restore } = setupSyncVaultFixture('oracle-vault-write-');
    const lockPath = path.join(testOracleDataDir, 'vault-sync.lock');

    try {
      const result = syncVault({ dryRun: false, repoRoot });
      expect(result.dryRun).toBe(false);
      expect(result.added).toBe(1);
      expect(result.modified).toBe(1);
      expect(result.deleted).toBe(1);
      expect(result.project).toBe('github.com/acme/app');
      expect(result.commitHash).toMatch(/^[0-9a-f]+$/);

      expect(fs.existsSync(path.join(vaultProjectPsi, 'new.md'))).toBe(true);
      expect(fs.readFileSync(path.join(vaultProjectPsi, 'new.md'), 'utf-8')).toContain('# new');
      expect(fs.readFileSync(path.join(vaultProjectPsi, 'changed.md'), 'utf-8')).toContain('# changed local');
      expect(fs.existsSync(path.join(vaultProjectPsi, 'deleted.md'))).toBe(false);
      expect(realExecSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim()).toBe('');
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      restore();
    }
  });

  it('write-run preserves other oracles universal resonance while deleting this projects stale files', () => {
    const { vaultPath, repoRoot, vaultProjectPsi, restore } = setupSyncVaultFixture('oracle-vault-universal-');
    const localResonance = path.join(repoRoot, 'ψ', 'memory', 'resonance');
    const vaultResonance = path.join(vaultPath, 'ψ', 'memory', 'resonance');

    try {
      fs.mkdirSync(localResonance, { recursive: true });
      fs.mkdirSync(vaultResonance, { recursive: true });
      fs.writeFileSync(path.join(localResonance, 'oracle-a.md'), '# oracle A resonance\n');
      fs.writeFileSync(path.join(vaultResonance, 'oracle-b.md'), '# oracle B resonance\n');
      realExecSync('git add -A && git commit -m resonance-fixture && git push', { cwd: vaultPath, stdio: 'pipe' });

      const result = syncVault({ dryRun: false, repoRoot });
      expect(result.dryRun).toBe(false);
      expect(result.added).toBe(2);
      expect(result.modified).toBe(1);
      expect(result.deleted).toBe(1);

      expect(fs.existsSync(path.join(vaultResonance, 'oracle-a.md'))).toBe(true);
      expect(fs.readFileSync(path.join(vaultResonance, 'oracle-b.md'), 'utf-8')).toContain('oracle B resonance');
      expect(fs.existsSync(path.join(vaultProjectPsi, 'deleted.md'))).toBe(false);
      expect(realExecSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim()).toBe('');
    } finally {
      restore();
    }
  });
});

// ============================================================================
// syncVault lock
// ============================================================================

describe('syncVault lock', () => {
  it('dry-run does not acquire or refuse on an existing live lock', () => {
    const { repoRoot, restore } = setupSyncVaultFixture('oracle-vault-lock-dry-');
    const lockPath = path.join(testOracleDataDir, 'vault-sync.lock');

    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }));
      const result = syncVault({ dryRun: true, repoRoot });
      expect(result.dryRun).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid);
    } finally {
      fs.rmSync(lockPath, { force: true });
      restore();
    }
  });

  it('refuses real sync when a live lock exists', () => {
    const { repoRoot, restore } = setupSyncVaultFixture('oracle-vault-lock-live-');
    const lockPath = path.join(testOracleDataDir, 'vault-sync.lock');

    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }));
      expect(() => syncVault({ dryRun: false, repoRoot })).toThrow(/Sync already running by PID/);
      expect(JSON.parse(fs.readFileSync(lockPath, 'utf-8')).pid).toBe(process.pid);
    } finally {
      fs.rmSync(lockPath, { force: true });
      restore();
    }
  });

  it('reclaims a stale lock and releases after real sync', () => {
    const { repoRoot, restore } = setupSyncVaultFixture('oracle-vault-lock-stale-');
    const lockPath = path.join(testOracleDataDir, 'vault-sync.lock');

    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, timestamp: '2026-01-01T00:00:00.000Z' }));
      const result = syncVault({ dryRun: false, repoRoot });
      expect(result.dryRun).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      fs.rmSync(lockPath, { force: true });
      restore();
    }
  });
});
