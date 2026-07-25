/**
 * The CI gate and the documented local gate must be the same command over the same suite.
 *
 * They were not. CI ran a hand-maintained `find(1)` list of 183 files — **15% of the 1,221
 * test files in this repo**. Whole directories were never executed, including
 * `tests/frontend/` (228 files) and `tests/build/`, which holds the 250-line ratchet and the
 * test-scope guard. Consequences, both real:
 *
 *  - #2848 left four tests red on `alpha` for hours while its check was green.
 *  - Two tests in `src/routes/menu/__tests__` had been red since #1857 (#2862).
 *
 * And the docs told contributors to run `bun test <path>` while CI ran
 * `bun test --isolate <path>` — different module semantics, so a local red could be a leaked
 * `mock.module` rather than a real failure, and a local green could be hiding one.
 *
 * Sibling of `test-scope.test.ts`, which exists because a *different* test-scoping bug (#2825)
 * also shipped silently. See #2853.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'bun';

const ROOT = join(import.meta.dir, '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/test.yml'), 'utf-8');
const CLAUDE_MD = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8');

/** Directories the CI workflow passes to `bun test`. */
function ciGroups(): string[] {
  // Split on the shell keyword `do` at the start of its own line — a bare `.split('do')`
  // truncates the list at `tests/docs`, which contains the substring. That mistake reported
  // 20 phantom uncovered groups on the first run of this very test.
  const after = WORKFLOW.split('for group in')[1] ?? '';
  const block = after.split(/\n\s*do\b/)[0] ?? '';
  return block
    .replace(/\\\s*\n/g, ' ')
    .split(/\s+/)
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter((entry) => entry.startsWith('src') || entry.startsWith('tests'));
}

/** Top-level groups that actually contain test files, from git — not from a glob. */
async function suiteGroups(): Promise<string[]> {
  const tracked = (await $`git -C ${ROOT} ls-files`.text()).split('\n');
  const groups = new Set<string>();
  for (const file of tracked) {
    if (!/\.test\.tsx?$/.test(file)) continue;
    if (file.startsWith('agents/')) continue;
    const parts = file.split('/');
    if (parts[0] === 'tests') groups.add(`tests/${parts[1]}`);
    else if (parts[0] === 'src') groups.add('src');
  }
  return [...groups];
}

/**
 * Groups CI deliberately skips. Each needs a reason — an unexplained exclusion is how the
 * 85% gap accumulated in the first place.
 */
const DELIBERATELY_EXCLUDED: Record<string, string> = {
  'tests/integration': 'one test needs a live docker compose stack',
  'tests/benchmarks': 'timing-sensitive; belongs in a scheduled job, not a PR gate',
  'tests/e2e': '*.e2e.ts needs a browser and is not picked up by bun test',
};

describe('CI runs the whole test suite', () => {
  test('every group containing tests is either run by CI or explicitly excluded', async () => {
    const covered = new Set(ciGroups());
    const missing = (await suiteGroups()).filter(
      (group) => !covered.has(group) && !(group in DELIBERATELY_EXCLUDED),
    );

    // If this fails: add the group to the loop in .github/workflows/test.yml, or add it to
    // DELIBERATELY_EXCLUDED with a reason. Do not delete this test.
    expect(missing).toEqual([]);
  });

  test('each exclusion is recorded in the workflow so it is visible at the gate', () => {
    for (const group of Object.keys(DELIBERATELY_EXCLUDED)) {
      expect(WORKFLOW).toContain(group);
    }
  });

  test('CI covers the two groups whose absence caused real regressions', () => {
    const covered = new Set(ciGroups());
    expect(covered.has('tests/frontend')).toBe(true); // #2848's four red tests lived here
    expect(covered.has('tests/build')).toBe(true); // the 250-line ratchet lives here
  });
});

describe('the documented gate is the command CI actually runs', () => {
  test('CI uses --isolate', () => {
    expect(WORKFLOW).toContain('bun test --isolate');
    // A bare `bun test <path>` in the workflow would mean the two gates disagree again.
    expect(WORKFLOW).not.toMatch(/bun test (?!--isolate)[^\n]*\btests?\//);
  });

  test('CLAUDE.md tells contributors to use --isolate', () => {
    expect(CLAUDE_MD).toContain('bun test --isolate');
  });

  test('CLAUDE.md says why, not just what', () => {
    // A rule without its reason gets "simplified" away by the next person.
    expect(CLAUDE_MD).toContain('mock.module');
  });
});
