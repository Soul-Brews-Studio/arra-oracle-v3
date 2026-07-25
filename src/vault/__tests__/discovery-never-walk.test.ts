/**
 * #2802 (@tenzaitech) — the vault walker descended into nested `.git` and `node_modules`.
 *
 * A repo with a submodule, a worktree, or a vendored dependency under ψ/ dragged its whole
 * object database into the walk: thousands of binary pack files, and an EACCES on the
 * read-only ones. `vault:migrate` then tried to copy them into the shared vault.
 *
 * These tests fail if the `NEVER_WALK` guard is removed — they assert on the walk's *contents*,
 * not just its size, so a count that happens to match cannot make them pass.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { walkFiles } from '../discovery.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vault-never-walk-'));
const psi = path.join(root, 'ψ');

function put(relative: string, body = 'x'): void {
  const full = path.join(psi, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

put('memory/learnings/real.md', '# real knowledge');
put('.git/HEAD', 'ref: refs/heads/main');
put('.git/objects/pack/pack-deadbeef.idx', 'binary');
put('vendor/node_modules/left-pad/index.js', 'module.exports = 1');
put('vendor/node_modules/.package-lock.json', '{}');

// A submodule or a linked worktree leaves `.git` behind as a FILE, not a directory.
// Written via put() so the parent directory is actually created — writing it directly made
// the walk throw ENOENT at module scope, and the "not.toContain" assertion below then
// passed because the file had never existed. `--isolate` is what surfaced that.
put('sub/.git', 'gitdir: ../../.git/modules/sub');

const walked = walkFiles(psi, root).map((file) => file.relativePath);

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('walkFiles never descends into .git or node_modules', () => {
  test('a nested object database contributes nothing', () => {
    expect(walked.filter((p) => p.includes('/.git/'))).toEqual([]);
  });

  test('a vendored node_modules contributes nothing', () => {
    expect(walked.filter((p) => p.includes('/node_modules/'))).toEqual([]);
  });

  test('a gitfile pointer is skipped too — it is not knowledge either', () => {
    expect(walked).not.toContain('ψ/sub/.git');
  });

  test('real knowledge is still walked — the guard is a filter, not a wall', () => {
    expect(walked).toContain('ψ/memory/learnings/real.md');
  });

  test('nothing but the real file survives this tree', () => {
    // The strongest form: name the whole expected set. Any leak fails here even if the
    // three targeted assertions above were weakened or deleted.
    expect(walked.sort()).toEqual(['ψ/memory/learnings/real.md']);
  });
});
