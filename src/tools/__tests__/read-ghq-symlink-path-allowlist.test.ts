import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathAllowed } from '../read.ts';

// isPathAllowed's security boundary: which realpaths oracle_read is allowed to
// serve. A ghq project entry (ghqRoot/host/org/repo) is often a symlink — to
// agent-hub (already allowed) or to anywhere else on the machine, e.g.
// vault/<repo> (previously rejected — the Barbara/nntn "Document not found"
// bug). The fix adds a project-scoped branch: resolve exactly the ONE
// first-level project entry named by `project` and allow paths under ITS
// realpath — not an open allow of arbitrary directories.

let root = '';
let ghqRoot = '';
let repoRoot = '';
let savedHome: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-read-allowlist-'));
  ghqRoot = path.join(root, 'ghq');
  repoRoot = path.join(root, 'repo');
  fs.mkdirSync(ghqRoot, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  savedHome = process.env.HOME;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('isPathAllowed — ghq project symlink boundary', () => {
  test('real (non-symlink) ghq project dir is allowed', () => {
    const projectDir = path.join(ghqRoot, 'github.com', 'org', 'plain-repo');
    fs.mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, 'note.md');
    fs.writeFileSync(filePath, 'plain');

    expect(isPathAllowed(fs.realpathSync(filePath), repoRoot, ghqRoot)).toBe(true);
  });

  test('ghq entry symlinked into agent-hub is allowed (existing behavior preserved)', () => {
    const fakeHome = path.join(root, 'home');
    const hubTarget = path.join(fakeHome, 'tt3p', 'agent-hub', 'hub-repo');
    fs.mkdirSync(hubTarget, { recursive: true });
    fs.writeFileSync(path.join(hubTarget, 'note.md'), 'hub');
    process.env.HOME = fakeHome;

    const projectLink = path.join(ghqRoot, 'github.com', 'org', 'hub-repo');
    fs.mkdirSync(path.dirname(projectLink), { recursive: true });
    fs.symlinkSync(hubTarget, projectLink);

    const resolved = fs.realpathSync(path.join(projectLink, 'note.md'));
    expect(isPathAllowed(resolved, repoRoot, ghqRoot)).toBe(true);
  });

  test('ghq entry symlinked into an arbitrary (non agent-hub) location is allowed when project is passed', () => {
    const vaultTarget = path.join(root, 'vault', 'nntn');
    fs.mkdirSync(vaultTarget, { recursive: true });
    fs.writeFileSync(path.join(vaultTarget, 'note.md'), 'vault');

    const project = 'github.com/ttt3p/nntn';
    const projectLink = path.join(ghqRoot, project);
    fs.mkdirSync(path.dirname(projectLink), { recursive: true });
    fs.symlinkSync(vaultTarget, projectLink);

    const resolved = fs.realpathSync(path.join(projectLink, 'note.md'));

    // Without the project hint, the pre-fix behavior (no agent-hub match, no
    // repoRoot match) correctly still rejects — proves the widening is opt-in
    // via `project`, not a blanket relaxation of the ghqRoot check.
    expect(isPathAllowed(resolved, repoRoot, ghqRoot)).toBe(false);
    expect(isPathAllowed(resolved, repoRoot, ghqRoot, project)).toBe(true);
  });

  test('a resolved path outside the claimed project realpath is rejected (hostile mismatch)', () => {
    const vaultTarget = path.join(root, 'vault', 'nntn');
    fs.mkdirSync(vaultTarget, { recursive: true });
    const project = 'github.com/ttt3p/nntn';
    const projectLink = path.join(ghqRoot, project);
    fs.mkdirSync(path.dirname(projectLink), { recursive: true });
    fs.symlinkSync(vaultTarget, projectLink);

    // A file that exists elsewhere on disk, unrelated to any project entry,
    // ghqRoot, agent-hub, or repoRoot — the claimed `project` doesn't cover it.
    const elsewhere = path.join(root, 'unrelated-secret');
    fs.mkdirSync(elsewhere, { recursive: true });
    const secretFile = path.join(elsewhere, 'secret.md');
    fs.writeFileSync(secretFile, 'classified');

    expect(isPathAllowed(fs.realpathSync(secretFile), repoRoot, ghqRoot, project)).toBe(false);
  });
});
