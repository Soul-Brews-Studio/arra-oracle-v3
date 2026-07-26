/**
 * No test calls `resetDefaultDatabaseForTests()` with no argument (#2897).
 *
 * `bun test --isolate tests/http/` runs ~290 files in ONE process. `--isolate` gives each file
 * a fresh module registry, not a fresh process, so a native `bun:sqlite` handle closed by one
 * file is closed for the whole run.
 *
 * That is not theoretical. #2894 failed CI twice on a test it does not touch —
 * `TurboVec sidecar reference speaks the vector proxy protocol` — with ECONNRESET, a *python
 * subprocess* dying on `POST /vectors/query` after health, stats and add all succeeded. Two
 * control runs isolated it:
 *
 *   #2895  alpha + one blank line ............ green → the base was fine
 *   #2896  the PR minus its test files ....... green → the routes were fine
 *
 * The cause was two new test files calling `resetDefaultDatabaseForTests()` at module scope.
 * The symptom was about as far from the cause as a symptom can get, and it looked exactly like
 * someone else's flake — it was read as one, twice, before the controls settled it.
 *
 * All 22 bare call sites were removed and every suite stayed green: the default `:memory:`
 * database already has the tables, so not one of them needed it. That is the claim this guard
 * enforces — the bare call has nothing to do, so it is pure risk.
 *
 * **Scope, deliberately narrow.** Calls that pass a path — `(':memory:')`, a `mkdtemp` file,
 * `(process.env.ORACLE_DB_PATH)` — are the escape hatch used as designed: they rebind the
 * module handle to a database the test owns. Around 130 files do this and CI is green, so the
 * blanket claim in #2897 (that any call endangers a shared run) is not supported by evidence
 * and is not enforced here. What is proven is narrower: the no-argument form does nothing.
 *
 * `tests/storage/db-index-reset-default.test.ts` is exempt — it is the function's own test.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const EXEMPT = new Set(['tests/storage/db-index-reset-default.test.ts']);

/**
 * `git ls-files` rather than a filesystem walk: it skips `agents/` worktrees and node_modules
 * for free, and the shell form of this took >5s in CI once (#2853) — spawnSync with argv does not.
 */
function trackedTestFiles(): string[] {
  const out = Bun.spawnSync(['git', 'ls-files', 'tests', 'src'], { cwd: REPO_ROOT });
  return new TextDecoder().decode(out.stdout)
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.(test|spec)\.[cm]?tsx?$/.test(file));
}

function callsReset(file: string): boolean {
  const path = join(REPO_ROOT, file);
  if (!existsSync(path)) return false;
  // Only the NO-ARGUMENT form. Passing a path (':memory:', a mkdtemp file) is the escape
  // hatch's intended use — it rebinds the module handle to a database the test owns, and ~130
  // files rely on it. The bare call is the one with nothing to do.
  return /resetDefaultDatabaseForTests\(\s*\)/.test(readFileSync(path, 'utf-8'));
}

function callers(): string[] {
  return trackedTestFiles().filter((file) => !EXEMPT.has(file)).filter(callsReset);
}

describe('the process-global database reset stays out of test files', () => {
  test('no test file calls it with no argument', () => {
    /**
     * If this fails: use `createDatabase()` on a temp path instead — see
     * `tests/workers/pointer-backfill.test.ts` for the pattern — or seed the default `:memory:`
     * database directly, which is what the 22 removed call sites turned out to be doing anyway.
     */
    expect(callers()).toEqual([]);
  });

  test('the guard can actually see call sites — it is not vacuously green', () => {
    // A guard that cannot fail is worse than no guard (#2847). The exempt file really does
    // call it, so finding it there proves the detection works.
    // The exempt file really does make a bare call, so finding it there proves detection works.
    expect(callsReset('tests/storage/db-index-reset-default.test.ts')).toBe(true);
  });
});
