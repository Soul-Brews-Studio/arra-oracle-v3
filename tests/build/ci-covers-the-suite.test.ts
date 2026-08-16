/**
 * CI must run the whole test suite, across BOTH tiers.
 *
 * It once did not. CI ran a hand-maintained `find(1)` list of 183 files — **15% of the
 * 1,221 test files in this repo**. Whole directories were never executed, including
 * `tests/frontend/` (229 files) and `tests/build/`, which holds the 250-line ratchet and
 * the test-scope guard. Consequences, both real:
 *
 *  - #2848 left four tests red on `alpha` for hours while its check was green.
 *  - Two tests in `src/routes/menu/__tests__` had been red since #1857 (#2862).
 *
 * The gate is now two files — `test.yml` (per-PR, under two minutes) and `nightly.yml`
 * (scheduled + manual, allowed to be slow). A tier split is EXACTLY the shape that
 * reintroduces #2853, so this ratchet got stricter with it, not looser:
 *
 *  - the union of both tiers must cover every directory that holds tests, and there is no
 *    longer an exclusion escape hatch — `tests/integration/`, `tests/benchmarks/` and
 *    `tests/e2e/` used to sit in a DELIBERATELY_EXCLUDED map, i.e. they ran nowhere;
 *  - a tier-1 entry may be a SUBSET of a group (tier 1 runs 7 of tests/http/'s 65
 *    subdirectories) only while the whole group runs in tier 2;
 *  - `*.spec.ts` directories are invisible to bun and so were invisible to the old
 *    version of this test — `tests/ui-audit/` had no runner anywhere. Now a Playwright
 *    directory must be claimed by a script the nightly workflow actually invokes.
 *
 * The other half of the split gate — that each tier RUNS its groups correctly — is
 * `ci-tier-contract.test.ts`. Sibling of `test-scope.test.ts`, which exists because a
 * *different* test-scoping bug (#2825) also shipped silently. See #2853.
 */
import { describe, expect, test } from 'bun:test';
import {
  covered,
  groupOf,
  isPartial,
  read,
  specGroups,
  suiteGroups,
  tier1Entries,
  tier1Whole,
  tier2Whole,
  TIER2,
} from './ci-tiers';

describe('the two tiers together run the whole suite', () => {
  test('every group containing tests is in tier 1 or tier 2', () => {
    const missing = suiteGroups().filter((group) => !covered.has(group));

    // If this fails: add the group to the loop in .github/workflows/test.yml (fast, per-PR)
    // or .github/workflows/nightly.yml (slow, scheduled). There is deliberately no
    // exclusion list to add it to any more. Do not delete this test.
    expect(missing).toEqual([]);
  });

  test('no group is silently skipped by being in neither loop', () => {
    // The inverse framing of the test above, stated as the invariant that matters: the
    // union is the suite. #2853 was 85% of the suite sitting in "neither".
    expect(covered.size).toBeGreaterThanOrEqual(suiteGroups().length);
    for (const group of suiteGroups()) {
      expect(covered.has(group), `${group} runs in neither tier`).toBe(true);
    }
  });

  test('the three groups that used to run NOWHERE now run in tier 2', () => {
    // These sat in a DELIBERATELY_EXCLUDED map with a reason attached, which reads like
    // coverage and is not. The reasons were real — docker, timing sensitivity, browsers —
    // and they are reasons to run a directory nightly, not reasons to run it never.
    for (const group of ['tests/integration', 'tests/benchmarks', 'tests/e2e']) {
      expect(tier2Whole.has(group), `${group} must run in the nightly tier`).toBe(true);
    }
  });

  test('tier 1 keeps the groups whose absence caused real regressions', () => {
    expect(tier1Whole.has('src')).toBe(true); // 1,016 tests, the core
    expect(tier1Whole.has('tests/frontend')).toBe(true); // #2848's four red tests lived here
    expect(tier1Whole.has('tests/build')).toBe(true); // the 250-line ratchet lives here
    expect(tier1Whole.has('tests/docs')).toBe(true); // the README/CLAUDE.md claim ratchets
  });

  test("a partial tier-1 entry is never a group's only coverage", () => {
    // Tier 1 runs 7 of tests/http/'s subdirectories (142 of 300 files, 14.8s of 57.2s).
    // That is only safe while the WHOLE group runs nightly. Without this rule a subset
    // list is just #2853 again at finer granularity.
    for (const entry of tier1Entries.filter(isPartial)) {
      const group = groupOf(entry);
      expect(
        tier2Whole.has(group),
        `${entry} runs part of ${group}; ${group}/ must run whole in nightly.yml`,
      ).toBe(true);
    }
  });

  test('every Playwright directory is claimed by a script the nightly runs', () => {
    // bunfig.toml excludes **/*.spec.ts from bun's runner, so these directories cannot
    // appear in either loop and were invisible to the old version of this test.
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    for (const group of specGroups()) {
      const script = group === 'tests/ui-audit' ? 'test:ui-audit' : 'test:e2e';
      expect(scripts[script], `${group} needs a ${script} script`).toContain('playwright');
      expect(TIER2, `${group} is run by no CI job`).toContain(`bun run ${script}`);
    }
  });
});
