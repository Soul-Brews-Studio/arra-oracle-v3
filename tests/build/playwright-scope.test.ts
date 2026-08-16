/**
 * Playwright specs must not be run by bun's test runner.
 *
 * bun auto-discovers BOTH `*.test.ts` and `*.spec.ts`. Two Playwright files use
 * the `.spec.ts` suffix on purpose — tests/e2e/contrast.spec.ts (named in
 * playwright.config.ts `testMatch`) and tests/ui-audit/audit.spec.ts (its own
 * config) — so bun picked them up and blew up on import:
 *
 *   bun test --isolate tests/e2e/       -> error: Playwright Test did not expect
 *   bun test --isolate tests/ui-audit/     test.describe() to be called here.
 *
 * bunfig.toml's comment asserted the opposite ("bun's auto-discovery skips
 * them"), and .github/workflows/test.yml:130 repeated it ("not picked up by bun
 * test anyway"). Both were describing an intent, not the artifact. CI never
 * caught it because tests/ui-audit/ is absent from the CI group list and
 * tests/e2e/ is deliberately excluded.
 *
 * The fix is a spec-suffix glob in bunfig.toml's pathIgnorePatterns. That
 * exclusion is only safe while no `.spec.ts` is a real bun test — this file is
 * the guard on that.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'agents', 'dist', '.tmp']);

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf-8');
}

/**
 * Walk for *.spec.ts. Kept subprocess-free so the gate cannot depend on git.
 *
 * BOTH bunfig roots, not just tests/. The exclusion glob is repo-wide, so a
 * src/**-spec file would be silently skipped by bun AND invisible to this guard
 * if we only walked tests/. Verified by planting src/rogue-probe.spec.ts
 * importing bun:test: the tests/-only version stayed 6 pass / 0 fail.
 */
function walkSpecs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkSpecs(rel));
    else if (entry.name.endsWith('.spec.ts')) found.push(rel);
  }
  return found;
}

function specFiles(): string[] {
  return ['src', 'tests'].flatMap(walkSpecs);
}

/** playwright configs hold regex source, so `contrast\.spec\.ts` — drop the escapes. */
function unescaped(rel: string): string {
  return read(rel).replaceAll('\\', '');
}

describe('playwright specs stay out of the bun gate', () => {
  test('bunfig.toml excludes *.spec.ts from bun test discovery', () => {
    const raw = read('bunfig.toml');
    expect(raw).toContain('**/*.spec.ts');
  });

  test('no *.spec.ts imports bun:test (the exclusion would hide a real test)', () => {
    const usingBunTest = specFiles().filter((f) => /from ['"]bun:test['"]/.test(read(f)));
    expect(usingBunTest).toEqual([]);
  });

  // The negative above is not enough on its own: a *.spec.ts importing NEITHER
  // runner would pass it while being run by nothing at all — which is exactly
  // the state tests/ui-audit/audit.spec.ts was in. Assert the positive too, so
  // the exclusion only ever covers files a playwright runner actually claims.
  test('every *.spec.ts imports @playwright/test', () => {
    const specs = specFiles();
    const notPlaywright = specs.filter((f) => !/from ['"]@playwright\/test['"]/.test(read(f)));
    expect(notPlaywright).toEqual([]);
  });

  test('every *.spec.ts is claimed by a playwright config', () => {
    const specs = specFiles();
    expect(specs.length).toBeGreaterThan(0);

    const rootConfig = unescaped('playwright.config.ts');
    const uiAuditConfig = read('tests/ui-audit/playwright.config.ts');

    for (const spec of specs) {
      const base = spec.split('/').pop() ?? spec;
      const claimed =
        rootConfig.includes(base) ||
        (spec.startsWith('tests/ui-audit/') && uiAuditConfig.includes('*.spec.ts'));
      expect(claimed, `${spec} is run by no playwright config and no bun gate`).toBe(true);
    }
  });

  test('the scripts bunfig.toml tells you to run actually exist', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    // bunfig.toml says: "E2E tests use Playwright (run with: bun run test:e2e)".
    // That script did not exist when the comment was written.
    expect(Object.keys(scripts)).toContain('test:e2e');
    expect(scripts['test:e2e']).toContain('playwright');
  });

  test('package.json repository url points at this repo, not its predecessor', () => {
    const pkg = JSON.parse(read('package.json')) as { repository?: { url?: string } };
    expect(pkg.repository?.url).toContain('arra-oracle-v3.git');
  });
});
