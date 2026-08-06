import { describe, expect, test } from 'bun:test';
import { normalizeGhqRepo } from '../ghq.ts';

describe('vault ghq repo normalization', () => {
  test('accepts trimmed ghq-style repo paths', () => {
    expect(normalizeGhqRepo('  github.com/Soul-Brews-Studio/arra-oracle-v3  '))
      .toBe('github.com/Soul-Brews-Studio/arra-oracle-v3');
    expect(normalizeGhqRepo('owner/repo')).toBe('owner/repo');
  });

  test('rejects shell metacharacters and traversal-looking repos', () => {
    expect(() => normalizeGhqRepo('owner/repo;touch /tmp/pwned')).toThrow(/ghq-style/);
    expect(() => normalizeGhqRepo('../repo')).toThrow(/ghq-style/);
    expect(() => normalizeGhqRepo('owner//repo')).toThrow(/ghq-style/);
    expect(() => normalizeGhqRepo('/absolute/repo')).toThrow(/ghq-style/);
  });
});
