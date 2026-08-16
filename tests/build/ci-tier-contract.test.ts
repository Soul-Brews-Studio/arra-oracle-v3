/**
 * Each CI tier must RUN its groups the way the docs say, and stay in its lane.
 *
 * `ci-covers-the-suite.test.ts` proves the union of the two tiers is the whole suite. That
 * is worth nothing if the command itself is wrong — a missing `--isolate` silently changes
 * module semantics, a missing trailing slash turns a path into a substring filter that
 * matched a *different repository* up the ghq tree, and a blanket retry would hide flaky
 * tests instead of surfacing them.
 *
 * It also guards the two budgets that justify the split existing at all: tier 1 carries no
 * Rust toolchain (124s of the old 377s gate), and tier 2 has no PR trigger, because "allowed
 * to be slow" is only true while nothing waits on it. See #2853, #2867, #2997.
 */
import { describe, expect, test } from 'bun:test';
import {
  CLAUDE_MD,
  TAURI,
  tier1Entries,
  tier2Entries,
  TIER1,
  TIER2,
  triggerBlock,
} from './ci-tiers';

describe('both tiers run the command the docs tell contributors to run', () => {
  test.each([
    ['test.yml', TIER1],
    ['nightly.yml', TIER2],
  ])('%s uses --isolate', (_name, workflow) => {
    expect(workflow).toContain('bun test --isolate');
    // A bare `bun test <path>` in a workflow would mean the gates disagree again.
    expect(workflow).not.toMatch(/bun test (?!--isolate)[^\n]*\btests?\//);
  });

  test.each([
    ['test.yml', tier1Entries],
    ['nightly.yml', tier2Entries],
  ])('%s keeps the trailing slash on every group', (_name, entries) => {
    // `bun test <path>` is a SUBSTRING FILTER, not a path: bare `tests/server` matched
    // `integration-tests/serverless.test.mjs` in a different repository up the ghq tree.
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((entry) => !entry.endsWith('/'))).toEqual([]);
  });

  test.each([
    ['test.yml', TIER1],
    ['nightly.yml', TIER2],
  ])('%s retries exit 133 once, and only 133', (_name, workflow) => {
    // 133 is bun CRASHING (SIGTRAP), not a test failing. Retrying anything else would hide
    // flaky tests, which is the opposite of what a gate is for. See #2867.
    expect(workflow).toContain('-eq 133');
    expect(workflow).not.toMatch(/-ne 0 \][^\n]*\n\s*bun test/);
  });

  test('tier 1 is the PR gate and tier 2 is scheduled plus manual', () => {
    expect(TIER1).toMatch(/on:\s*\n\s*pull_request:/);
    expect(triggerBlock(TIER2)).toContain('schedule:');
    expect(triggerBlock(TIER2)).toContain('workflow_dispatch:');
  });

  test('tier 2 can never block a PR', () => {
    // The nightly is allowed to be slow only because nothing waits on it. The moment it
    // gains a pull_request trigger it is the old single-tier gate again, wearing a new
    // filename — so the budget that justifies its contents is asserted, not assumed.
    expect(triggerBlock(TIER2)).not.toContain('pull_request');
    expect(triggerBlock(TIER2)).not.toContain('push:');
  });

  test('the nightly cron lands in the GMT+7 morning', () => {
    // 02:00 UTC = 09:00 GMT+7 (Bangkok). A nightly whose result nobody sees until the
    // afternoon buys a day of latency on every regression it catches.
    const cron = triggerBlock(TIER2).match(/cron:\s*'([^']+)'/)?.[1];
    expect(cron, 'nightly.yml needs a cron schedule').toBeDefined();
    const [minute, hour] = (cron ?? '').split(' ');
    const gmt7 = (Number(hour) + 7) % 24;
    expect(Number.isNaN(gmt7)).toBe(false);
    expect(gmt7, `cron '${cron}' fires at ${gmt7}:${minute} GMT+7, not the morning`)
      .toBeGreaterThanOrEqual(6);
    expect(gmt7).toBeLessThanOrEqual(10);
  });

  test('the PR gate carries no Rust toolchain', () => {
    // 124s of a 377s gate (33%) on a directory most PRs never touch. It moved to
    // tauri.yml (path-filtered) and to the nightly, and must not drift back.
    expect(TIER1).not.toContain('cargo check');
    expect(TIER1).not.toContain('rust-toolchain');
    expect(TAURI).toContain('cargo check');

    // Path-filtered, or it is the same 124s bill with an extra file. And the nightly runs
    // the same check unconditionally, so a shared-dependency break cannot hide behind the
    // filter for more than a day.
    expect(triggerBlock(TAURI)).toContain('paths:');
    expect(triggerBlock(TAURI)).toContain('frontend/src-tauri/**');
    expect(TIER2).toContain('cargo check');
  });

  test('CLAUDE.md tells contributors to use --isolate', () => {
    expect(CLAUDE_MD).toContain('bun test --isolate');
  });

  test('CLAUDE.md says why, not just what', () => {
    // A rule without its reason gets "simplified" away by the next person.
    expect(CLAUDE_MD).toContain('mock.module');
  });
});
