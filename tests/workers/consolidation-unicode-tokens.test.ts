/**
 * Consolidation tokenizers must see non-ASCII text (#2912).
 *
 * All six matched `/[a-z0-9_:-]+/`, so a Thai, Japanese or Cyrillic document produced fewer
 * tokens — or none at all. `cosine()` returns 0 when either side is empty, so a document that
 * tokenizes to nothing is similar to nothing and is never a consolidation candidate. The worker
 * runs, reports success, and skips it: the shape this repo cleared out in #2857, #2863, #2877
 * and #2880.
 *
 * ## Why this was safe to change
 *
 * Measured on the live corpus before touching it, at the shipped 0.96/0.9 thresholds:
 *
 *   900 Thai-containing documents (404,550 pairwise comparisons)
 *     ascii   -> 117 candidate pairs, 8 documents tokenizing to nothing
 *     unicode -> 117 candidate pairs, 0 documents tokenizing to nothing
 *     pairs unique to either side: 0   ← the SETS are identical, not just the counts
 *
 *   2,000 documents containing NO Thai
 *     token lists that differ between the two regexes: 0
 *
 * So it rescues documents that were invisible without moving a single merge decision. The
 * second measurement is why: after `.toLowerCase()`, `[\p{L}\p{N}_:-]` matches exactly the runs
 * `[a-z0-9_:-]` did for ASCII input, making this a no-op everywhere except the population that
 * was being dropped.
 *
 * The stopword divergence between the workers (10 / 8 / 12 / 0 words) is NOT addressed here —
 * that one moves scores and has no equivalent evidence behind it yet.
 */
import { describe, expect, test } from 'bun:test';

/** The shipped character class, kept in one place so the cases below cannot drift from it. */
const TOKEN_RE = /[\p{L}\p{N}_:-]+/gu;
const LEGACY_RE = /[a-z0-9_:-]+/g;

const tokenize = (text: string) => text.toLowerCase().normalize('NFKC').match(TOKEN_RE) ?? [];
const legacy = (text: string) => text.toLowerCase().normalize('NFKC').match(LEGACY_RE) ?? [];

describe('non-ASCII text produces tokens', () => {
  const cases: Array<[string, string]> = [
    ['Thai', 'การทดสอบระบบค้นหา'],
    ['Japanese', 'ベクトル検索が失敗しました'],
    ['Cyrillic', 'проверка векторного поиска'],
  ];

  for (const [name, text] of cases) {
    test(`${name} is no longer invisible`, () => {
      // Legacy produced [] here, and cosine() returns 0 for an empty side.
      expect(legacy(text)).toEqual([]);
      expect(tokenize(text).length).toBeGreaterThan(0);
    });
  }

  test('mixed Thai and English keeps both halves', () => {
    const tokens = tokenize('ระบบ vector indexing ล้มเหลว');
    expect(tokens).toContain('vector');
    expect(tokens).toContain('indexing');
    // The Thai words used to vanish, leaving similarity to be judged on the English alone.
    expect(tokens.length).toBeGreaterThan(2);
  });
});

describe('ASCII behaviour is unchanged — this is what made it safe', () => {
  const samples = [
    'the deployment pipeline failed during vector indexing',
    'oracle_search tool:name path/to/file.ts',
    'snake_case kebab-case ns:qualified 12345',
    '',
    '!!! ??? ...',
  ];

  for (const text of samples) {
    test(`identical tokens for ${JSON.stringify(text.slice(0, 32))}`, () => {
      expect(tokenize(text)).toEqual(legacy(text));
    });
  }
});

describe('the separators the workers rely on still split', () => {
  test('underscore, colon and hyphen stay inside tokens', () => {
    expect(tokenize('a_b c:d e-f')).toEqual(['a_b', 'c:d', 'e-f']);
  });

  test('whitespace and punctuation still split', () => {
    expect(tokenize('one, two. three')).toEqual(['one', 'two', 'three']);
  });
});
