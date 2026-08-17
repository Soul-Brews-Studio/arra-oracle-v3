/**
 * Regression tests for detectProject() against REAL filesystem topology —
 * no realpathSync mocking.
 *
 * Reproduces the 2026-08-17 auto-scope failure: the real checkout is a
 * HOSTLESS directory (~/hub/repo) and the ghq path
 * (ghq/github.com/owner/repo) is a symlink pointing AT it — the inverse of
 * the original design assumption. realpathSync erases the host segment for
 * both input forms, so raw-input parsing and a git-origin fallback are both
 * required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectProject, parseOriginUrl } from '../project-detect.ts';

let root: string;
let realRepo: string;        // hostless real checkout (agent-hub style)
let ghqLink: string;         // ghq symlink -> realRepo (TINE's direction)
let noOriginRepo: string;    // git repo without an origin remote
let plainDir: string;        // not a git repo at all

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-detect-topology-'));

  realRepo = path.join(root, 'hub', 'orchestrator-vnext');
  fs.mkdirSync(path.join(realRepo, 'src', 'deep'), { recursive: true });
  git(realRepo, 'init', '-q');
  git(realRepo, 'remote', 'add', 'origin', 'https://github.com/TTT3P/Orchestrator-vNext.git');

  const ghqDir = path.join(root, 'ghq', 'github.com', 'ttt3p');
  fs.mkdirSync(ghqDir, { recursive: true });
  ghqLink = path.join(ghqDir, 'orchestrator-vnext');
  fs.symlinkSync(realRepo, ghqLink);

  noOriginRepo = path.join(root, 'hub', 'no-origin');
  fs.mkdirSync(noOriginRepo, { recursive: true });
  git(noOriginRepo, 'init', '-q');

  plainDir = path.join(root, 'plain');
  fs.mkdirSync(plainDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('detectProject — inverted ghq topology (ghq symlink -> hostless real repo)', () => {
  it('resolves the ghq symlink path despite realpath erasing the host segment', () => {
    expect(detectProject(ghqLink)).toBe('github.com/ttt3p/orchestrator-vnext');
  });

  it('resolves the hostless real path via git-origin fallback', () => {
    expect(detectProject(realRepo)).toBe('github.com/ttt3p/orchestrator-vnext');
  });

  it('both input forms resolve to the SAME project', () => {
    expect(detectProject(ghqLink)).toBe(detectProject(realRepo)!);
  });

  it('resolves a nested cwd inside the hostless real repo', () => {
    expect(detectProject(path.join(realRepo, 'src', 'deep'))).toBe(
      'github.com/ttt3p/orchestrator-vnext',
    );
  });

  it('normalises the origin URL to lowercase without .git', () => {
    // origin was added as https://github.com/TTT3P/Orchestrator-vNext.git
    expect(detectProject(realRepo)).toBe('github.com/ttt3p/orchestrator-vnext');
  });
});

describe('detectProject — git-origin URL forms', () => {
  it('normalises git@ SSH origin URLs', () => {
    const sshRepo = path.join(root, 'hub', 'ssh-repo');
    fs.mkdirSync(sshRepo, { recursive: true });
    git(sshRepo, 'init', '-q');
    git(sshRepo, 'remote', 'add', 'origin', 'git@github.com:TTT3P/Maw-JS.git');
    expect(detectProject(sshRepo)).toBe('github.com/ttt3p/maw-js');
  });

  it('parseOriginUrl handles HTTPS, SSH, ssh:// and rejects garbage', () => {
    expect(parseOriginUrl('https://github.com/Owner/Repo.git')).toBe('github.com/owner/repo');
    expect(parseOriginUrl('git@gitlab.com:Owner/Repo.git')).toBe('gitlab.com/owner/repo');
    expect(parseOriginUrl('ssh://git@github.com/Owner/Repo')).toBe('github.com/owner/repo');
    expect(parseOriginUrl('not-a-url')).toBeNull();
    expect(parseOriginUrl('/local/path/repo')).toBeNull();
  });
});

describe('detectProject — never guess', () => {
  it('returns null for a git repo with no origin remote', () => {
    expect(detectProject(noOriginRepo)).toBeNull();
  });

  it('returns null for a plain non-repo directory (no basename guessing)', () => {
    expect(detectProject(plainDir)).toBeNull();
  });

  it('returns null for a nonexistent hostless path', () => {
    expect(detectProject(path.join(root, 'does', 'not', 'exist'))).toBeNull();
  });
});
