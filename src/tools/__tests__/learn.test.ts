/**
 * Unit tests for learn helpers (pure functions).
 */

import { describe, it, expect } from 'bun:test';
import { normalizeProject, extractProjectFromSource } from '../learn.ts';

// ============================================================================
// normalizeProject
// ============================================================================

describe('normalizeProject', () => {
  it('should return null for empty input', () => {
    expect(normalizeProject(undefined)).toBeNull();
    expect(normalizeProject('')).toBeNull();
  });

  it('should pass through already-normalized format', () => {
    expect(normalizeProject('github.com/owner/repo')).toBe('github.com/owner/repo');
  });

  it('should normalize GitHub URLs', () => {
    expect(normalizeProject('https://github.com/owner/repo')).toBe('github.com/owner/repo');
    expect(normalizeProject('https://github.com/owner/repo.git')).toBe('github.com/owner/repo');
  });

  it('should normalize local ghq paths', () => {
    expect(normalizeProject('/Users/nat/Code/github.com/owner/repo')).toBe('github.com/owner/repo');
    expect(normalizeProject('~/Code/github.com/owner/repo/src/file.ts')).toBe('github.com/owner/repo');
  });

  it('should normalize short owner/repo format', () => {
    expect(normalizeProject('owner/repo')).toBe('github.com/owner/repo');
  });

  it('should normalize to lowercase', () => {
    expect(normalizeProject('github.com/Soul-Brews-Studio/Oracle-V2')).toBe('github.com/soul-brews-studio/oracle-v2');
    expect(normalizeProject('https://github.com/Owner/Repo')).toBe('github.com/owner/repo');
    expect(normalizeProject('Owner/Repo')).toBe('github.com/owner/repo');
  });

  it('should return null for unrecognized formats', () => {
    expect(normalizeProject('just-a-name')).toBeNull();
    expect(normalizeProject('too/many/slashes/here')).toBeNull();
  });
});

// ============================================================================
// extractProjectFromSource
// ============================================================================

describe('extractProjectFromSource', () => {
  it('should return null for empty input', () => {
    expect(extractProjectFromSource(undefined)).toBeNull();
    expect(extractProjectFromSource('')).toBeNull();
  });

  it('should extract from "oracle_learn from github.com/owner/repo" format', () => {
    expect(extractProjectFromSource('oracle_learn from github.com/owner/repo session 42'))
      .toBe('github.com/owner/repo');
  });

  it('should extract from "rrr: org/repo" format', () => {
    expect(extractProjectFromSource('rrr: Soul-Brews-Studio/oracle-v2'))
      .toBe('github.com/soul-brews-studio/oracle-v2');
  });

  it('should extract direct github.com reference', () => {
    expect(extractProjectFromSource('some text github.com/foo/bar more text'))
      .toBe('github.com/foo/bar');
  });

  it('should return null when no project found', () => {
    expect(extractProjectFromSource('just some random text')).toBeNull();
  });
});
