import { expect, test } from 'bun:test';
import { QueryCache, stableCacheKey } from '../../src/vector/query-cache.ts';

test('query cache returns entries before ttl and evicts after expiry', () => {
  let now = 1000;
  const cache = new QueryCache<number>({ ttlMs: 50, now: () => now });
  cache.set('a', 1);

  expect(cache.get('a')).toBe(1);
  now = 1051;
  expect(cache.get('a')).toBeUndefined();
});

test('stable cache key is independent of object key order', () => {
  expect(stableCacheKey({ b: 2, a: 1 })).toBe(stableCacheKey({ a: 1, b: 2 }));
});


test('query cache sanitizes invalid sizing options without retaining disabled entries', () => {
  const cache = new QueryCache<number>({ ttlMs: Number.NaN, maxEntries: 0 });
  cache.set('a', 1);

  expect(cache.get('a')).toBeUndefined();
  expect(cache.stats()).toMatchObject({ size: 0, maxEntries: 0, ttlMs: 30_000 });
});

test('stable cache key recursively sorts nested object keys', () => {
  const left = stableCacheKey({ where: { b: 2, a: { y: 2, x: 1 } }, q: 'oracle' });
  const right = stableCacheKey({ q: 'oracle', where: { a: { x: 1, y: 2 }, b: 2 } });

  expect(left).toBe(right);
});
