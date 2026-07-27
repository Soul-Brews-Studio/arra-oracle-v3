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
