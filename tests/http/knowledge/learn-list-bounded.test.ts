/**
 * `GET /api/learn` must do a BOUNDED amount of work, whatever the corpus size.
 *
 * It used to select every matching row with no LIMIT and then issue one further
 * synchronous FTS query per row. `oracle_fts` is an FTS5 virtual table with
 * `id UNINDEXED`, so each of those lookups is a full scan (~20ms measured). On
 * the reference corpus — 35,179 documents, 17,500 learnings — that is roughly
 * 350 seconds of blocking work on Elysia's single event loop. The server pinned
 * at 100% CPU and stopped answering anything at all: a plain unauthenticated GET
 * was a denial of service.
 *
 * Two things this test exists to stop coming back:
 *   1. an unbounded result set
 *   2. per-row FTS lookups
 *
 * Note on how the bug hid: an in-process `Promise.race` with `setTimeout` will
 * NOT catch it, because the timer lives on the same event loop the handler is
 * blocking. It has to be an OS-level timeout, or an assertion on the shape of
 * the work as below.
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_LEARN_LIMIT,
  MAX_LEARN_LIMIT,
  clampLimit,
  clampOffset,
  createLearnListRoutes,
  listLearnEntries,
} from '../../../src/routes/learn/list.ts';

describe('learn list pagination guards', () => {
  test('an absent or unparseable limit falls back to the default', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LEARN_LIMIT);
    expect(clampLimit('')).toBe(DEFAULT_LEARN_LIMIT);
    expect(clampLimit('not-a-number')).toBe(DEFAULT_LEARN_LIMIT);
  });

  test('limit is clamped to a hard ceiling — this is the DoS guard', () => {
    expect(clampLimit(99999)).toBe(MAX_LEARN_LIMIT);
    expect(clampLimit('99999')).toBe(MAX_LEARN_LIMIT);
    expect(clampLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEARN_LIMIT);
    expect(clampLimit(Infinity)).toBe(DEFAULT_LEARN_LIMIT); // not finite -> default
  });

  test('limit can never be zero or negative', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-10)).toBe(1);
  });

  test('offset is non-negative and integral', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(-5)).toBe(0);
    expect(clampOffset('12')).toBe(12);
    expect(clampOffset(7.9)).toBe(7);
  });

  test('the ceiling is low enough to stay bounded', () => {
    // If someone raises MAX_LEARN_LIMIT to "unlimited", the guard is gone.
    expect(MAX_LEARN_LIMIT).toBeLessThanOrEqual(1000);
    expect(DEFAULT_LEARN_LIMIT).toBeLessThanOrEqual(MAX_LEARN_LIMIT);
  });
});

describe('learn list response contract', () => {
  test('never returns more items than the requested limit', () => {
    const page = listLearnEntries(5, 0);
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.limit).toBe(5);
    expect(page.offset).toBe(0);
  });

  test('total reports the full set, not just the page', () => {
    const page = listLearnEntries(1, 0);
    expect(typeof page.total).toBe('number');
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  });

  test('offset advances the window without changing total', () => {
    const first = listLearnEntries(2, 0);
    const second = listLearnEntries(2, 2);
    expect(second.offset).toBe(2);
    expect(second.total).toBe(first.total);
    const overlap = first.items.filter((item) => second.items.some((other) => other.id === item.id));
    expect(overlap).toEqual([]);
  });

  test('the route caps a hostile limit rather than honouring it', async () => {
    const app = createLearnListRoutes();
    const res = await app.handle(new Request('http://local/learn?limit=999999'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; limit: number };
    expect(body.limit).toBe(MAX_LEARN_LIMIT);
    expect(body.items.length).toBeLessThanOrEqual(MAX_LEARN_LIMIT);
  });

  test('a default request is bounded even with no query string', async () => {
    const app = createLearnListRoutes();
    const res = await app.handle(new Request('http://local/learn'));
    const body = (await res.json()) as { items: unknown[]; limit: number };
    expect(body.limit).toBe(DEFAULT_LEARN_LIMIT);
    expect(body.items.length).toBeLessThanOrEqual(DEFAULT_LEARN_LIMIT);
  });
});
