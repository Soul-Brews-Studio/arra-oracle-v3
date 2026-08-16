/**
 * CLAUDE.md's factual claims must be true.
 *
 * `readme-claims.test.ts` has held README to this standard for a while. CLAUDE.md had no
 * equivalent — it was referenced by four tests, each pinning one rule it states, but nothing
 * checked the file's own assertions about how this repo works.
 *
 * It matters more than README does. README is read once; CLAUDE.md is loaded into every
 * session and every contributor's context, so a wrong line there is repeated back as fact
 * indefinitely. The versioning line is the proof: it documented `-alpha.{HOUR}` while
 * `scripts/calver.ts:55` **rejects** `--hour` with "deprecated; CalVer uses HMM wall-clock
 * suffixes". The file that governs behaviour was describing a format the tool refuses.
 *
 * Only mechanically checkable claims are asserted here. Judgement calls ("the cleanest
 * reference module") are left alone — a guard that cannot fail is worse than no guard (#2847).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const CLAUDE_MD = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf-8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>;

describe('versioning claims match scripts/calver.ts', () => {
  const calver = readFileSync(join(ROOT, 'scripts/calver.ts'), 'utf-8');

  test('CLAUDE.md documents the HMM suffix the script actually emits', () => {
    expect(CLAUDE_MD).toContain('-alpha.{HMM}');
  });

  test('CLAUDE.md does not document the HOUR suffix the script rejects', () => {
    // `calver.ts:55` fails on `--hour` with "deprecated; CalVer uses HMM wall-clock suffixes".
    expect(CLAUDE_MD).not.toContain('-alpha.{HOUR}');
  });

  test('the script still describes the scheme CLAUDE.md claims', () => {
    // If calver.ts changes its scheme, this fails and the doc gets updated with it — which is
    // the direction the drift ran last time.
    expect(calver).toContain('{HMM}');
  });
});

describe('framework claims', () => {
  test('no Hono dependency remains, as claimed', () => {
    expect(CLAUDE_MD).toContain('no Hono dependency remains');
    const deps = { ...(PACKAGE.dependencies as object), ...(PACKAGE.devDependencies as object) };
    expect(Object.keys(deps)).not.toContain('hono');
  });

  test('there is no src/routes-elysia/ staging dir, as claimed', () => {
    expect(CLAUDE_MD).toContain('no `src/routes-elysia/` staging dir');
    expect(existsSync(join(ROOT, 'src/routes-elysia'))).toBe(false);
  });

  test('src/routes/health/ exists, since CLAUDE.md points newcomers at it', () => {
    expect(CLAUDE_MD).toContain('src/routes/health/');
    expect(existsSync(join(ROOT, 'src/routes/health'))).toBe(true);
  });
});

describe('test-layout claims match bunfig.toml', () => {
  const bunfig = readFileSync(join(ROOT, 'bunfig.toml'), 'utf-8');

  test('roots are what CLAUDE.md says', () => {
    expect(CLAUDE_MD).toContain('roots = ["src", "tests"]');
    expect(bunfig).toContain('roots = ["src", "tests"]');
  });

  test('pathIgnorePatterns excludes agents/, and CLAUDE.md says why', () => {
    // Removing this ENTRY is what let sibling worktrees run in every suite (#2825).
    // Asserted by entry, not by the whole array literal: the list legitimately grows
    // (a spec-suffix glob joined it in #2997), and pinning the literal made an
    // unrelated addition fail this test while agents/ was still excluded.
    const patterns = /pathIgnorePatterns\s*=\s*\[(.*?)\]/s.exec(bunfig)?.[1] ?? '';
    expect(patterns).toContain('**/agents/**');
    expect(CLAUDE_MD).toContain('pathIgnorePatterns');
  });

  test('CLAUDE.md tells contributors to use --isolate', () => {
    // The documented local gate and the CI gate were different commands until #2853.
    expect(CLAUDE_MD).toContain('bun test --isolate');
  });
});

describe('runtime claims', () => {
  test('the documented backend port is the code default', () => {
    const consts = readFileSync(join(ROOT, 'src/const.ts'), 'utf-8');
    const port = consts.match(/ORACLE_DEFAULT_PORT\s*=\s*(\d+)/)?.[1];
    expect(port).toBe('47778');
    expect(CLAUDE_MD).toContain('47778');
  });

  test('the documented Bun floor matches package.json engines', () => {
    expect(CLAUDE_MD).toContain('Bun ≥ 1.2');
    expect(String((PACKAGE.engines as Record<string, string> | undefined)?.bun ?? '')).toContain('1.2');
  });
});
