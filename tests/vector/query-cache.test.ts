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
