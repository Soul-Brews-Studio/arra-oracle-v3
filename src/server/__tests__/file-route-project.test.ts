/**
 * Unit tests for /api/file project → basePath resolution logic.
 *
 * The bug: short project slugs (e.g. "sticker-gen", "mmv-tarots") were
 * previously treated as ghq path components, producing incorrect base paths
 * like /Users/non/ghq/sticker-gen instead of REPO_ROOT.
 *
 * Fix: only full github.com/owner/repo paths use GHQ_ROOT as base;
 * short slugs fall back to REPO_ROOT so source_file resolves correctly.
 */

import { describe, it, expect } from 'bun:test';
import path from 'path';

// ─── Mirror the exact basePath logic from src/routes/files.ts ───────────────

const REPO_ROOT = '/Users/non/dev/arra-oracle-v3';
const GHQ_ROOT = '/Users/non/ghq';

function resolveBasePath(project: string | undefined): string {
  const isGhqPath = project && project.startsWith('github.com/');
  return isGhqPath ? path.join(GHQ_ROOT, project) : REPO_ROOT;
}

function resolveFilePath(filePath: string, project: string | undefined): string {
  const isGhqPath = project && project.startsWith('github.com/');
  const basePath = resolveBasePath(project);
  let resolvedFilePath = filePath;
  if (isGhqPath && filePath.toLowerCase().startsWith(project!.toLowerCase() + '/')) {
    resolvedFilePath = filePath.slice(project!.length + 1);
  }
  return path.join(basePath, resolvedFilePath);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('isGhqPath detection', () => {
  it('returns true for github.com/owner/repo', () => {
    const project = 'github.com/mojisejr/arra-oracle-v3';
    expect(project.startsWith('github.com/')).toBe(true);
  });

  it('returns false for short slug like sticker-gen', () => {
    expect('sticker-gen'.startsWith('github.com/')).toBe(false);
  });

  it('returns false for short slug like mmv-tarots', () => {
    expect('mmv-tarots'.startsWith('github.com/')).toBe(false);
  });

  it('returns false for shared', () => {
    expect('shared'.startsWith('github.com/')).toBe(false);
  });

  it('returns false for undefined', () => {
    const project = undefined;
    const isGhqPath = project && project.startsWith('github.com/');
    expect(isGhqPath).toBeFalsy();
  });
});

describe('basePath resolution — short slug projects', () => {
  it('uses REPO_ROOT for short slug "sticker-gen"', () => {
    expect(resolveBasePath('sticker-gen')).toBe(REPO_ROOT);
  });

  it('uses REPO_ROOT for short slug "mmv-tarots"', () => {
    expect(resolveBasePath('mmv-tarots')).toBe(REPO_ROOT);
  });

  it('uses REPO_ROOT for short slug "oracle"', () => {
    expect(resolveBasePath('oracle')).toBe(REPO_ROOT);
  });

  it('uses REPO_ROOT for short slug "shared"', () => {
    expect(resolveBasePath('shared')).toBe(REPO_ROOT);
  });

  it('uses REPO_ROOT when project is undefined', () => {
    expect(resolveBasePath(undefined)).toBe(REPO_ROOT);
  });
});

describe('basePath resolution — ghq paths', () => {
  it('uses GHQ_ROOT for full github.com path', () => {
    expect(resolveBasePath('github.com/mojisejr/arra-oracle-v3')).toBe(
      '/Users/non/ghq/github.com/mojisejr/arra-oracle-v3',
    );
  });

  it('uses GHQ_ROOT for another full github.com path', () => {
    expect(resolveBasePath('github.com/soul-brews-studio/arra-oracle-v3')).toBe(
      '/Users/non/ghq/github.com/soul-brews-studio/arra-oracle-v3',
    );
  });
});

describe('full path resolution — snapshot docs with short slug project', () => {
  it('resolves snapshot source_file correctly against REPO_ROOT', () => {
    const sourceFile = 'ψ/memory/logs/sticker-gen/2026-02-09_23-19_detailed-execution-plan.md';
    const project = 'sticker-gen';
    const resolved = resolveFilePath(sourceFile, project);
    expect(resolved).toBe(
      '/Users/non/dev/arra-oracle-v3/ψ/memory/logs/sticker-gen/2026-02-09_23-19_detailed-execution-plan.md',
    );
  });

  it('resolves retro source_file correctly when project is mmv-tarots', () => {
    const sourceFile = 'ψ/memory/retrospectives/2025-12/20/21.52_auth-complete.md';
    const project = 'mmv-tarots';
    const resolved = resolveFilePath(sourceFile, project);
    expect(resolved).toBe(
      '/Users/non/dev/arra-oracle-v3/ψ/memory/retrospectives/2025-12/20/21.52_auth-complete.md',
    );
  });

  it('resolves source_file when project is undefined (NULL in DB)', () => {
    const sourceFile = 'ψ/memory/retrospectives/2026-01/01/10.00_some-retro.md';
    const resolved = resolveFilePath(sourceFile, undefined);
    expect(resolved).toBe(
      '/Users/non/dev/arra-oracle-v3/ψ/memory/retrospectives/2026-01/01/10.00_some-retro.md',
    );
  });
});

describe('full path resolution — ghq docs (must still work)', () => {
  it('resolves ghq source_file using GHQ_ROOT base', () => {
    const sourceFile = 'ψ/memory/learnings/some-learning.md';
    const project = 'github.com/mojisejr/arra-oracle-v3';
    const resolved = resolveFilePath(sourceFile, project);
    expect(resolved).toBe(
      '/Users/non/ghq/github.com/mojisejr/arra-oracle-v3/ψ/memory/learnings/some-learning.md',
    );
  });

  it('strips project prefix from source_file when it is a ghq path', () => {
    // Some old docs may have source_file = "github.com/owner/repo/ψ/memory/..."
    const sourceFile = 'github.com/mojisejr/arra-oracle-v3/ψ/memory/learnings/foo.md';
    const project = 'github.com/mojisejr/arra-oracle-v3';
    const resolved = resolveFilePath(sourceFile, project);
    expect(resolved).toBe(
      '/Users/non/ghq/github.com/mojisejr/arra-oracle-v3/ψ/memory/learnings/foo.md',
    );
  });

  it('does NOT strip short slug from source_file (slug is not a path prefix)', () => {
    // source_file never starts with "sticker-gen/" — it always starts with ψ/
    const sourceFile = 'ψ/memory/logs/sticker-gen/file.md';
    const project = 'sticker-gen';
    const resolved = resolveFilePath(sourceFile, project);
    // path should be REPO_ROOT/ψ/memory/logs/sticker-gen/file.md (no stripping)
    expect(resolved).toBe('/Users/non/dev/arra-oracle-v3/ψ/memory/logs/sticker-gen/file.md');
  });
});
