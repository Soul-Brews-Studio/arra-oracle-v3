/**
 * Pure path and git-status helpers — no mocks, no database, no filesystem.
 *
 * Split out of `handler.test.ts` (#2833): 433 lines against the 250-line rule. These four
 * describes only exercise pure functions, and they now import them from their SOURCE modules
 * (`../git.ts`, `../path-mapping.ts`) rather than through `../handler.ts`.
 *
 * That matters beyond file size. `handler.test.ts` registers process-wide `mock.module()` calls
 * for `../../db/index.ts` and `../discovery.ts`, and CLAUDE.md documents that those leak into
 * sibling files and fail two unrelated `syncVault lock` tests when `--isolate` is omitted.
 * Importing the pure modules directly keeps this half entirely out of that blast radius — it
 * needs none of those mocks, and now carries none.
 *
 * It does NOT fix the leak. Measured without `--isolate`, before and after: the same two
 * `syncVault lock` tests fail either way. What changed is that 25 tests no longer participate
 * in it — `handler.test.ts` still registers the mocks for the syncVault suites that need them.
 */
import { describe, it, expect } from 'bun:test';
import { parseGitStatus } from '../git.ts';
import { mapToVaultPath, mapFromVaultPath, ensureFrontmatterProject } from '../path-mapping.ts';

// ============================================================================
// parseGitStatus
// ============================================================================

describe('parseGitStatus', () => {
  it('returns zeros for empty output', () => {
    expect(parseGitStatus('')).toEqual({ added: 0, modified: 0, deleted: 0 });
    expect(parseGitStatus('  \n  ')).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it('counts untracked files as added', () => {
    const status = '?? ψ/memory/new-file.md\n?? ψ/memory/another.md';
    expect(parseGitStatus(status)).toEqual({ added: 2, modified: 0, deleted: 0 });
  });

  it('counts staged additions as added', () => {
    const status = 'A  ψ/memory/new-file.md';
    expect(parseGitStatus(status)).toEqual({ added: 1, modified: 0, deleted: 0 });
  });

  it('counts deletions', () => {
    const status = ' D ψ/memory/old-file.md\n D ψ/memory/gone.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 0, deleted: 2 });
  });

  it('counts modifications', () => {
    const status = ' M ψ/memory/changed.md\nM  ψ/memory/also-changed.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 2, deleted: 0 });
  });

  it('counts renames as modified', () => {
    const status = 'R  ψ/old-name.md -> ψ/new-name.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 1, deleted: 0 });
  });

  it('counts copies as added and type changes as modified', () => {
    const status = 'C  ψ/source.md -> ψ/copy.md\nT  ψ/memory/link.md';
    expect(parseGitStatus(status)).toEqual({ added: 1, modified: 1, deleted: 0 });
  });

  it('handles mixed status output', () => {
    const status = [
      '?? ψ/memory/new.md',
      'A  ψ/memory/staged-new.md',
      ' M ψ/memory/changed.md',
      ' D ψ/memory/removed.md',
      'R  ψ/old.md -> ψ/renamed.md',
    ].join('\n');

    expect(parseGitStatus(status)).toEqual({ added: 2, modified: 2, deleted: 1 });
  });

  it('handles staged deletions (D in index column)', () => {
    const status = 'D  ψ/memory/deleted.md';
    expect(parseGitStatus(status)).toEqual({ added: 0, modified: 0, deleted: 1 });
  });
});

// ============================================================================
// mapToVaultPath
// ============================================================================

describe('mapToVaultPath', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('prefixes learnings with project', () => {
    expect(mapToVaultPath('ψ/memory/learnings/file.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/file.md');
  });

  it('prefixes retrospectives with project', () => {
    expect(mapToVaultPath('ψ/memory/retrospectives/2026-01/15/session.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/retrospectives/2026-01/15/session.md');
  });

  it('prefixes inbox/handoff with project', () => {
    expect(mapToVaultPath('ψ/inbox/handoff/context.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/inbox/handoff/context.md');
  });

  it('keeps resonance universal (no project prefix)', () => {
    expect(mapToVaultPath('ψ/memory/resonance/philosophy.md', project))
      .toBe('ψ/memory/resonance/philosophy.md');
  });

  it('returns path unchanged when project is null', () => {
    expect(mapToVaultPath('ψ/memory/learnings/file.md', null))
      .toBe('ψ/memory/learnings/file.md');
  });

  it('handles nested learning files', () => {
    expect(mapToVaultPath('ψ/memory/learnings/deep/nested/file.md', project))
      .toBe('github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/deep/nested/file.md');
  });
});

// ============================================================================
// mapFromVaultPath
// ============================================================================

describe('mapFromVaultPath', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('strips project prefix from learnings path', () => {
    expect(mapFromVaultPath(
      'github.com/soul-brews-studio/oracle-v2/ψ/memory/learnings/file.md',
      project
    )).toBe('ψ/memory/learnings/file.md');
  });

  it('strips project prefix from retrospectives path', () => {
    expect(mapFromVaultPath(
      'github.com/soul-brews-studio/oracle-v2/ψ/memory/retrospectives/2026-01/15/session.md',
      project
    )).toBe('ψ/memory/retrospectives/2026-01/15/session.md');
  });

  it('keeps resonance path as-is', () => {
    expect(mapFromVaultPath('ψ/memory/resonance/philosophy.md', project))
      .toBe('ψ/memory/resonance/philosophy.md');
  });

  it('returns null for unrecognized paths', () => {
    expect(mapFromVaultPath('some/random/path.md', project)).toBeNull();
  });

  it('returns null for different project paths', () => {
    expect(mapFromVaultPath(
      'github.com/other-org/other-repo/ψ/memory/learnings/file.md',
      project
    )).toBeNull();
  });
});

// ============================================================================
// ensureFrontmatterProject
// ============================================================================

describe('ensureFrontmatterProject', () => {
  const project = 'github.com/soul-brews-studio/oracle-v2';

  it('adds frontmatter when none exists', () => {
    const content = '# My Learning\n\nSome content here.';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toBe(
      `---\nproject: ${project}\n---\n\n# My Learning\n\nSome content here.`
    );
  });

  it('injects project into existing frontmatter', () => {
    const content = '---\ntags: [git, safety]\nsource: Oracle Learn\n---\n\n# Content';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toContain(`project: ${project}`);
    expect(result).toContain('tags: [git, safety]');
    expect(result).toContain('source: Oracle Learn');
  });

  it('injects project into CRLF frontmatter without duplicating fences', () => {
    const content = '---\r\ntags: [git, safety]\r\n---\r\n\r\n# Content';
    const result = ensureFrontmatterProject(content, project);
    expect(result).toContain(`project: ${project}`);
    expect(result.startsWith('---\r\n')).toBe(true);
    expect(result.match(/^---/gm)?.length).toBe(2);
  });

  it('does not modify if project already exists', () => {
    const content = `---\nproject: ${project}\ntags: [test]\n---\n\n# Content`;
    const result = ensureFrontmatterProject(content, project);
    expect(result).toBe(content);
  });

  it('preserves existing project field even if different', () => {
    const content = '---\nproject: github.com/other/repo\n---\n\n# Content';
    const result = ensureFrontmatterProject(content, project);
    // Should NOT modify — project field already exists
    expect(result).toBe(content);
  });
});

// ============================================================================
// syncVault dry-run
// ============================================================================

