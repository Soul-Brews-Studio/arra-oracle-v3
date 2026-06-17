import { expect, test } from 'bun:test';
import { buildTenantFtsQuery, parseConcepts, parseOffset, parsePositiveInt, parseSearchMode } from '../../../src/search/query.ts';

test('search parsers reject partial and unsafe numeric values', () => {
  expect(parsePositiveInt('2abc', 10, 100)).toBe(10);
  expect(parsePositiveInt('9007199254740993', 10, 100)).toBe(10);
  expect(parsePositiveInt(' 25 ', 10, 20)).toBe(20);
  expect(parseOffset('-1')).toBe(0);
  expect(parseOffset('003')).toBe(3);
});

test('search mode parser trims, lowercases, and rejects unknown modes', () => {
  expect(parseSearchMode(undefined)).toBe('hybrid');
  expect(parseSearchMode(' FTS ')).toBe('fts');
  expect(parseSearchMode('nearest')).toBeNull();
});

test('FTS query builders strip punctuation, dedupe terms, and cap token fanout', () => {
  const raw = '<b>alpha</b> beta alpha gamma delta epsilon zeta eta theta iota OR ( )';

  expect(buildTenantFtsQuery(raw)).toBe('"alpha" OR "beta" OR "gamma" OR "delta" OR "epsilon" OR "zeta" OR "eta" OR "theta"');
});

test('parseConcepts trims, de-duplicates, and ignores non-string entries', () => {
  expect(parseConcepts('[" oracle ", "oracle", 7, "memory"]')).toEqual(['oracle', 'memory']);
  expect(parseConcepts('not-json')).toEqual([]);
});
