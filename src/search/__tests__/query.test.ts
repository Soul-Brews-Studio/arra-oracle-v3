import { describe, expect, test } from 'bun:test';
import { buildTenantFtsQuery, parseConcepts, parseOffset, parsePositiveInt, parseSearchMode } from '../query.ts';

describe('search query helpers', () => {
  test('strictly parses pagination integers', () => {
    expect(parsePositiveInt('25', 10, 100)).toBe(25);
    expect(parsePositiveInt('25abc', 10, 100)).toBe(10);
    expect(parsePositiveInt('0', 10, 100)).toBe(10);
    expect(parsePositiveInt('500', 10, 100)).toBe(100);
    expect(parseOffset(' 5 ')).toBe(5);
    expect(parseOffset('-1')).toBe(0);
    expect(parseOffset('1.5')).toBe(0);
  });

  test('normalizes modes, concepts, and tenant FTS tokens', () => {
    expect(parseSearchMode(' FTS ')).toBe('fts');
    expect(parseSearchMode('nearest')).toBeNull();
    expect(parseConcepts('[" one ","one",7,"two"]')).toEqual(['one', 'two']);
    expect(parseConcepts('"not-array"')).toEqual([]);
    expect(buildTenantFtsQuery('<b>alpha</b> OR ( beta alpha gamma delta epsilon zeta eta theta iota'))
      .toBe('"alpha" OR "OR" OR "beta" OR "gamma" OR "delta" OR "epsilon" OR "zeta" OR "eta"');
  });
});
