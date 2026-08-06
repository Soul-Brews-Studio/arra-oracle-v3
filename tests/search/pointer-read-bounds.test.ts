/**
 * The pointer read path must stay bounded (#2880).
 *
 * `hydratePointerDocs` used to pass every matched document id into `inArray(...)` joined onto
 * `oracle_fts`. That was free while `oracle_pointer_index` was empty — `ids` was always `[]` —
 * so it survived unnoticed for the table's entire life. Backfilling the table exposed it: one
 * query took **over 120 seconds** on the real corpus.
 *
 * Measured on the backfilled 35,179-document database:
 *
 *   unbounded join (original) ....... >120,000 ms
 *   candidate cap 200 ................  3,100 ms
 *   candidate cap 50 .................    700 ms   (trades recall)
 *   two queries, cap 200 .............     31 ms   (shipped)
 *
 * These tests pin the two properties that keep it there, because the failure mode is silent:
 * search still returns correct results, just slowly enough to be unusable.
 */
import { describe, expect, test } from 'bun:test';
import {
  estimateIdCount,
  hydrationCap,
  MAX_POINTER_DOCS,
  rankDocs,
  tooCommonToRank,
  topRankedIds,
} from '../../src/search/pointer-ranking.ts';

function rankedOf(n: number): Map<string, { score: number; matches: string[] }> {
  const map = new Map<string, { score: number; matches: string[] }>();
  for (let i = 0; i < n; i += 1) map.set(`doc-${i}`, { score: i / n, matches: ['x'] });
  return map;
}

describe('candidate hydration is capped', () => {
  test('a huge match set is truncated to the cap', () => {
    const ids = topRankedIds(rankedOf(20_000), 10);
    expect(ids.length).toBe(hydrationCap(10));
    expect(ids.length).toBeLessThan(20_000);
  });

  test('a small match set is returned whole — ordinary queries are unaffected', () => {
    expect(topRankedIds(rankedOf(7), 10).length).toBe(7);
  });

  test('the highest-scoring documents are the ones kept', () => {
    // Truncating by insertion order instead of score would silently drop the best results.
    const ids = topRankedIds(rankedOf(20_000), 1);
    expect(ids).toContain('doc-19999');
    expect(ids).not.toContain('doc-0');
  });

  test('the cap scales with limit rather than being fixed', () => {
    expect(hydrationCap(100)).toBeGreaterThan(hydrationCap(10));
  });

  test('ties break deterministically', () => {
    const tied = new Map([...Array(500).keys()].map((i) => [`doc-${i}`, { score: 0.5, matches: [] as string[] }]));
    expect(topRankedIds(tied, 1)).toEqual(topRankedIds(tied, 1));
  });
});

describe('pointers that match most of the corpus are skipped', () => {
  test('a pointer over the threshold is too common to rank', () => {
    const huge = JSON.stringify(Array.from({ length: MAX_POINTER_DOCS + 10 }, (_, i) => `d${i}`));
    expect(tooCommonToRank(huge)).toBe(true);
  });

  test('an ordinary pointer is not', () => {
    expect(tooCommonToRank(JSON.stringify(['a', 'b', 'c']))).toBe(false);
  });

  test('rankDocs ignores the too-common pointer entirely', () => {
    /**
     * On the real corpus `date|2026` lists 34,614 of 35,179 documents — 98%. A key that matches
     * almost everything cannot discriminate, so reading it is pure cost.
     */
    const huge = JSON.stringify(Array.from({ length: MAX_POINTER_DOCS + 10 }, (_, i) => `d${i}`));
    const ranked = rankDocs(
      [
        { kind: 'date', key: '2026', docIds: huge },
        { kind: 'entity', key: 'deploy', docIds: JSON.stringify(['keeper']) },
      ],
      [{ kind: 'date', key: '2026', label: '2026' }, { kind: 'entity', key: 'deploy', label: 'deploy' }],
    );
    expect(ranked.has('keeper')).toBe(true);
    expect(ranked.has('d0')).toBe(false);
    expect(ranked.size).toBe(1);
  });

  test('counting ids does not require parsing them', () => {
    // The parse is the cost being avoided, so the estimate must be close without JSON.parse.
    expect(estimateIdCount('[]')).toBe(0);
    expect(estimateIdCount(JSON.stringify(['a']))).toBe(1);
    expect(estimateIdCount(JSON.stringify(['a', 'b', 'c']))).toBe(3);
  });
});
