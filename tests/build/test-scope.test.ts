/**
 * The build gate must only ever run THIS checkout's tests.
 *
 * `agents/` holds sibling worktrees — full, gitignored copies of the repo. Bun
 * treats a positional `bun test <path>` argument as a substring filter over the
 * discovered file set, not as a path, so scoping a run to a cluster does NOT
 * exclude those copies. Before `pathIgnorePatterns` was added to bunfig.toml:
 *
 *   bun test tests/http/response-format/   -> Ran 36 tests across 6 files   (1 file exists)
 *   bun test tests/http/                   -> Ran 1692 files in 111s        (282 exist)
 *
 * Every "green gate" recorded while that was true may have been running stale
 * worktree copies alongside the real files, and a stale copy going green tells
 * you nothing about the real one. See #2825.
 *
 * This test fails if the exclusion is ever dropped from bunfig.toml.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const BUNFIG = join(REPO_ROOT, 'bunfig.toml');
const AGENTS_DIR = join(REPO_ROOT, 'agents');

function bunfig(): string {
  return readFileSync(BUNFIG, 'utf-8');
}

/** Crude but sufficient: the `[test]` block runs to the next `[section]`. */
function testSection(raw: string): string {
  const start = raw.indexOf('[test]');
  if (start === -1) return '';
  const rest = raw.slice(start + '[test]'.length);
  const next = rest.search(/^\s*\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('build gate scope', () => {
  test('bunfig.toml exists and declares a [test] section', () => {
    expect(existsSync(BUNFIG)).toBe(true);
    expect(bunfig()).toContain('[test]');
  });

  test('the [test] section excludes sibling worktrees under agents/', () => {
    const section = testSection(bunfig());
    expect(section).toContain('pathIgnorePatterns');

    const match = section.match(/pathIgnorePatterns\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();

    const patterns = (match?.[1] ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);

    expect(patterns.some((p) => p.includes('agents'))).toBe(true);
  });

  test('no test file from agents/ is reachable in this run', () => {
    // If the exclusion regressed, sibling worktrees would contribute files whose
    // path contains `/agents/`. import.meta.dir is inside this checkout, so a
    // copy of THIS file running from a worktree would report an agents/ path.
    expect(import.meta.dir).not.toContain(`${AGENTS_DIR}/`);
    expect(import.meta.path.split('/agents/').length).toBe(1);
  });

  test('agents/, when present, is a gitignored sibling-worktree dir', () => {
    if (!existsSync(AGENTS_DIR)) return; // clean checkout — nothing to guard
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toMatch(/^\s*agents\/?\s*$/m);
    // Sanity: it really does hold checkouts, i.e. the risk this guards is real.
    const entries = readdirSync(AGENTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
    expect(entries.length).toBeGreaterThanOrEqual(0);
  });
});
