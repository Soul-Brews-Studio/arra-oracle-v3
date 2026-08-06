/**
 * All consolidation workers must tokenize the same way (#2912).
 *
 * There were six private tokenizers and no two agreed — three stopword lists of 10, 8 and 12
 * words, two workers with no filtering at all, and two different character classes. The same
 * `minCosine` / `minOverlap` therefore meant six different things depending on which worker
 * read it.
 *
 * ## Why unifying was safe
 *
 * Measured at the shipped `0.96 / 0.9` before changing anything:
 *
 *   700 general documents      10-word / 8-word / 12-word sets -> 28 pairs each, 0 set difference
 *   900 Thai-containing docs   10 / 8 / 12 / NONE              -> 117 pairs each, 0 difference
 *
 * Even removing stopwords entirely changed no candidate. At those thresholds only near-
 * duplicates qualify, and a near-duplicate shares essentially every token regardless of four
 * function words.
 *
 * **That is a property of 0.96/0.9, not of the tokenizer.** Lower the thresholds to catch
 * near-misses rather than near-duplicates and the stopword list starts to matter — which is the
 * actual argument for having one of them instead of six.
 */
import { describe, expect, test } from 'bun:test';
import {
  CONSOLIDATION_STOPWORDS,
  MIN_TOKEN_LENGTH,
  tokenizeForConsolidation,
  tokenSetForConsolidation,
} from '../../src/workers/tokenize.ts';

describe('one definition of a token', () => {
  test('the set form and the list form agree', () => {
    const text = 'deployment pipeline deployment vector';
    expect([...tokenSetForConsolidation(text)].sort()).toEqual([...new Set(tokenizeForConsolidation(text))].sort());
  });

  test('stopwords are filtered', () => {
    const tokens = tokenizeForConsolidation('the vector and the pipeline');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('and');
    expect(tokens).toContain('vector');
    expect(tokens).toContain('pipeline');
  });

  test('the list is the superset of every list that existed', () => {
    // 12 words, from fact-curation.ts — the longest of the four.
    for (const word of ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'use', 'uses']) {
      expect(CONSOLIDATION_STOPWORDS.has(word)).toBe(true);
    }
  });

  test('short tokens are dropped', () => {
    expect(tokenizeForConsolidation('a bc def')).toEqual(['def']);
    expect(MIN_TOKEN_LENGTH).toBe(3);
  });
});

describe('identifier shapes survive as single tokens', () => {
  test('underscore, colon and hyphen stay inside a token', () => {
    /**
     * `snake_case`, `ns:qualified` and `kebab-case` are single identifiers in this corpus.
     * Splitting them would make unrelated documents share tokens and look similar.
     */
    expect(tokenizeForConsolidation('snake_case ns:qualified kebab-case'))
      .toEqual(['snake_case', 'ns:qualified', 'kebab-case']);
  });

  test('whitespace and other punctuation still split', () => {
    expect(tokenizeForConsolidation('one, two. three!')).toEqual(['one', 'two', 'three']);
  });
});

describe('non-ASCII text is tokenized, not dropped', () => {
  for (const [name, text] of [['Thai', 'การทดสอบระบบ'], ['Japanese', 'ベクトル検索'], ['Cyrillic', 'проверка поиска']] as const) {
    test(`${name} produces tokens`, () => {
      // These produced [] under the old ASCII-only class, so cosine() scored them 0 against
      // everything and they were never consolidation candidates (#2914).
      expect(tokenizeForConsolidation(text).length).toBeGreaterThan(0);
    });
  }

  test('mixed script keeps both halves', () => {
    const tokens = tokenizeForConsolidation('ระบบ vector indexing ล้มเหลว');
    expect(tokens).toContain('vector');
    expect(tokens).toContain('indexing');
    expect(tokens.length).toBeGreaterThan(2);
  });
});

describe('empty and degenerate input', () => {
  test('empty string yields nothing', () => {
    expect(tokenizeForConsolidation('')).toEqual([]);
  });

  test('stopwords only yields nothing', () => {
    expect(tokenizeForConsolidation('the and for with')).toEqual([]);
  });

  test('null-ish input does not throw', () => {
    // Callers concatenate optional fields; an undefined one must not take the worker down.
    expect(tokenizeForConsolidation(undefined as unknown as string)).toEqual([]);
  });
});
