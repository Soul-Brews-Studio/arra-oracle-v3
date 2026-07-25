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
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { assertCorpusNotEmpty, clearLearnCorpus, seedLearnCorpus } from '../../helpers/seed-learn-corpus.ts';
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

/**
 * These ran against an EMPTY in-memory database (#2847). `bun test` sets NODE_ENV=test, which
 * makes the default DB `':memory:'`, and nothing seeded it — so "never returns more items than
 * the limit" was asserting `0 <= 500`, and the overlap check compared two empty arrays. All
 * green, all meaningless: reintroducing the per-row FTS lookup left this file at 10 pass / 0
 * fail. They now run against a seeded corpus, and refuse to run against an empty one.
 */
const SEED_COUNT = 12;

describe('learn list response contract', () => {
  beforeAll(() => {
    clearLearnCorpus();
    seedLearnCorpus({ count: SEED_COUNT });
  });

  afterAll(() => {
    clearLearnCorpus();
  });

  test('the corpus is actually populated — otherwise nothing below means anything', () => {
    expect(assertCorpusNotEmpty()).toBeGreaterThanOrEqual(SEED_COUNT);
    expect(listLearnEntries(SEED_COUNT, 0).items.length).toBe(SEED_COUNT);
  });

  test('never returns more items than the requested limit', () => {
    const page = listLearnEntries(5, 0);
    // The point: there ARE more than 5 rows, so the limit is doing work.
    expect(page.total).toBeGreaterThan(5);
    expect(page.items.length).toBe(5);
    expect(page.limit).toBe(5);
    expect(page.offset).toBe(0);
  });

  test('total reports the full set, not just the page', () => {
    const page = listLearnEntries(1, 0);
    expect(page.items.length).toBe(1);
    expect(page.total).toBeGreaterThanOrEqual(SEED_COUNT);
    expect(page.total).toBeGreaterThan(page.items.length);
  });

  test('offset advances the window without changing total', () => {
    const first = listLearnEntries(2, 0);
    const second = listLearnEntries(2, 2);
    expect(first.items.length).toBe(2);
    expect(second.items.length).toBe(2);
    expect(second.offset).toBe(2);
    expect(second.total).toBe(first.total);
    const overlap = first.items.filter((item) => second.items.some((other) => other.id === item.id));
    expect(overlap).toEqual([]);
  });

  test('a page carries the real content, not an empty body', () => {
    // Content comes from oracle_fts via ONE `IN (...)` scan. If that join breaks, every item
    // still arrives — with an empty body. An empty corpus could never have caught that.
    const page = listLearnEntries(3, 0);
    expect(page.items.length).toBe(3);
    for (const item of page.items) {
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  test('ordering is newest-first and stable across pages', () => {
    const all = listLearnEntries(SEED_COUNT, 0).items;
    const updatedAts = all.map((item) => item.updatedAt);
    expect([...updatedAts].sort((a, b) => b - a)).toEqual(updatedAts);
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

/**
 * The assertion that actually catches the #2835 denial of service.
 *
 * A seeded corpus proves the route returns the *right* rows; it says nothing about how much
 * work it did to get them. The original bug returned perfectly correct results — it just
 * issued one full FTS5 scan per row (~20ms each, 17,500 of them, on one event loop).
 *
 * So the property is **the number of FTS statements**, not the number of rows. Counted by
 * wrapping `Database.prototype.prepare`, which is where drizzle compiles its SQL.
 */
describe('one FTS scan per request, whatever the page size', () => {
  const PAGE_SIZES = [1, 5, 25, 50];
  let restore: () => void;
  let ftsStatements: string[] = [];

  beforeAll(async () => {
    clearLearnCorpus('fts-count');
    seedLearnCorpus({ count: 60, prefix: 'fts-count' });

    const { Database } = await import('bun:sqlite');
    const proto = Database.prototype as unknown as Record<string, (sql: string, ...rest: unknown[]) => unknown>;
    const originals: Record<string, (sql: string, ...rest: unknown[]) => unknown> = {};
    for (const name of ['prepare', 'query']) {
      originals[name] = proto[name];
      proto[name] = function (this: unknown, sql: string, ...rest: unknown[]) {
        if (typeof sql === 'string' && sql.includes('oracle_fts')) ftsStatements.push(sql);
        return originals[name].call(this, sql, ...rest);
      };
    }
    restore = () => { for (const name of ['prepare', 'query']) proto[name] = originals[name]; };
  });

  afterAll(() => {
    restore?.();
    clearLearnCorpus('fts-count');
  });

  for (const size of PAGE_SIZES) {
    test(`a page of ${size} costs exactly one FTS statement`, () => {
      ftsStatements = [];
      const page = listLearnEntries(size, 0);

      // Guard the guard: if the page came back empty the count would be trivially low.
      expect(page.items.length).toBe(size);
      expect(ftsStatements.length).toBe(1);
    });
  }

  test('cost does not grow with page size — that is the whole defect', () => {
    ftsStatements = [];
    listLearnEntries(1, 0);
    const forOne = ftsStatements.length;

    ftsStatements = [];
    listLearnEntries(50, 0);
    const forFifty = ftsStatements.length;

    // Per-row lookups would make this 1 vs 50.
    expect(forFifty).toBe(forOne);
  });

  test('the one statement fetches the whole page at once', () => {
    ftsStatements = [];
    listLearnEntries(25, 0);
    expect(ftsStatements).toHaveLength(1);
    // `IN (...)` for the page, not `id = ?` per row.
    expect(ftsStatements[0]).toMatch(/\bin\b/i);
  });
});
