/**
 * `GET /api/stats` does live work on every field: a document count, an FTS
 * health read, an embedder probe, and per-engine vector stats. The Studio calls
 * it on every page load and Elysia is single-threaded, so each call occupies the
 * only loop there is.
 *
 * It was NOT the cause of the 2026-07-25 wedge — `/api/memory/consolidation/
 * suggestions` was (#2843), and `/api/stats` merely queued behind it and looked
 * guilty in the log. This is defence in depth.
 *
 * The property that matters most is not the TTL but the **in-flight collapse**:
 * a dashboard opening several panels at once must cause ONE computation, not
 * one per panel.
 */
import { describe, expect, test } from 'bun:test';
import { DEFAULT_STATS_TTL_MS, createStatsCache } from '../../../src/routes/health/stats-cache.ts';

function counter() {
  let calls = 0;
  return {
    get calls() { return calls; },
    compute: async () => { calls += 1; return { n: calls }; },
  };
}

describe('stats cache', () => {
  test('a second call inside the TTL does not recompute', async () => {
    const c = counter();
    const cache = createStatsCache<{ n: number }>({ ttlMs: 1_000, now: () => 0 });
    expect(await cache.get(c.compute)).toEqual({ n: 1 });
    expect(await cache.get(c.compute)).toEqual({ n: 1 });
    expect(c.calls).toBe(1);
  });

  test('a call after the TTL recomputes', async () => {
    const c = counter();
    let clock = 0;
    const cache = createStatsCache<{ n: number }>({ ttlMs: 1_000, now: () => clock });
    await cache.get(c.compute);
    clock = 1_001;
    expect(await cache.get(c.compute)).toEqual({ n: 2 });
    expect(c.calls).toBe(2);
  });

  test('a burst of concurrent callers causes ONE computation', async () => {
    // The point of the cache on a single-threaded server. Without in-flight
    // collapsing, a TTL alone does nothing for callers that arrive together —
    // none of them has a cached value to read yet.
    const c = counter();
    const cache = createStatsCache<{ n: number }>({ ttlMs: 1_000, now: () => 0 });
    const results = await Promise.all(Array.from({ length: 8 }, () => cache.get(c.compute)));
    expect(c.calls).toBe(1);
    expect(results.every((r) => r.n === 1)).toBe(true);
  });

  test('a failed computation is not cached and does not wedge the cache', async () => {
    let attempt = 0;
    const cache = createStatsCache<string>({ ttlMs: 10_000, now: () => 0 });
    const flaky = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('probe failed');
      return 'ok';
    };
    await expect(cache.get(flaky)).rejects.toThrow('probe failed');
    // A rejected in-flight promise must be cleared, or every later call inherits it.
    expect(await cache.get(flaky)).toBe('ok');
  });

  test('ttl 0 disables caching entirely', async () => {
    const c = counter();
    const cache = createStatsCache<{ n: number }>({ ttlMs: 0, now: () => 0 });
    await cache.get(c.compute);
    await cache.get(c.compute);
    expect(c.calls).toBe(2);
  });

  test('ORACLE_STATS_CACHE_TTL_MS is honoured, including an explicit 0', async () => {
    const c = counter();
    const off = createStatsCache<{ n: number }>({ env: { ORACLE_STATS_CACHE_TTL_MS: '0' }, now: () => 0 });
    await off.get(c.compute);
    await off.get(c.compute);
    expect(c.calls).toBe(2);

    const c2 = counter();
    const on = createStatsCache<{ n: number }>({ env: { ORACLE_STATS_CACHE_TTL_MS: '9999' }, now: () => 0 });
    await on.get(c2.compute);
    await on.get(c2.compute);
    expect(c2.calls).toBe(1);
  });

  test('nonsense in the env falls back to the default rather than disabling', async () => {
    const c = counter();
    const cache = createStatsCache<{ n: number }>({ env: { ORACLE_STATS_CACHE_TTL_MS: 'soon' }, now: () => 0 });
    await cache.get(c.compute);
    await cache.get(c.compute);
    expect(c.calls).toBe(1);
    expect(DEFAULT_STATS_TTL_MS).toBeGreaterThan(0);
  });

  test('the default TTL is short enough to stay a dashboard read', () => {
    // If someone raises this to minutes the endpoint stops reflecting reality
    // and becomes misleading rather than merely stale.
    expect(DEFAULT_STATS_TTL_MS).toBeLessThanOrEqual(30_000);
  });

  test('clear() forces the next call to recompute', async () => {
    const c = counter();
    const cache = createStatsCache<{ n: number }>({ ttlMs: 10_000, now: () => 0 });
    await cache.get(c.compute);
    cache.clear();
    await cache.get(c.compute);
    expect(c.calls).toBe(2);
  });
});
