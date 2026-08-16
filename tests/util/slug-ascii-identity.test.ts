/**
 * Widening the slug alphabet must not move a single existing ASCII slug.
 *
 * Every slug in this repo is half of a filename or a document id that is already on disk
 * and already in the database. A rule change that shifts ASCII output does not "improve"
 * those names, it orphans them: `<date>_deploy-checklist.md` stops being found by the
 * name the indexer recorded. So the ASCII half of the change has to be provably a no-op,
 * not argued to be one.
 *
 * This test keeps the PRE-CHANGE expressions verbatim as the reference implementation and
 * asserts the new ones agree on ASCII, exhaustively:
 *
 *   - all 128 code points, alone;
 *   - all 16,384 ordered pairs of them;
 *   - every triple over an alphabet chosen to cover the interesting transitions
 *     (separator runs, leading/trailing hyphens, case folding);
 *   - real titles taken from the repo's own tests.
 *
 * If it ever goes red, the character class gained or lost an ASCII character — check
 * whether the new escape covers something `[a-z0-9]` did not ('_' is \p{Pc}, so it must
 * still be dropped; ASCII digits are \p{Nd}; no ASCII character is \p{M}).
 */
import { describe, expect, test } from 'bun:test';
import { slugifySnippet, slugifyTitle } from '../../src/util/slug.ts';

/** The rule as it stood on alpha before this change: src/learn/markdown.ts:29-35. */
function legacyTitle(value: string, limit: number): string {
  return value
    .substring(0, limit)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The rule as it stood on alpha before this change: src/trace/learning-files.ts:18-22. */
function legacySnippet(value: string, limit: number): string {
  return value
    .slice(0, limit)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const ASCII = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i));

function firstDivergence(inputs: Iterable<string>, limit: number): string | null {
  for (const input of inputs) {
    if (slugifyTitle(input, limit) !== legacyTitle(input, limit)) return `title:${JSON.stringify(input)}`;
    if (slugifySnippet(input, limit) !== legacySnippet(input, limit)) return `snippet:${JSON.stringify(input)}`;
  }
  return null;
}

describe('ASCII slugs are byte-identical to the pre-change rule', () => {
  test('every single ASCII code point', () => {
    expect(firstDivergence(ASCII, 50)).toBeNull();
  });

  test('every ordered pair of ASCII code points', () => {
    function* pairs() {
      for (const a of ASCII) for (const b of ASCII) yield a + b;
    }
    expect(firstDivergence(pairs(), 50)).toBeNull();
  });

  test('every triple over the characters that drive the transitions', () => {
    // Separators, hyphens, case, digits, the strippable punctuation and the NUL/control
    // edge — the classes where a character-class change could plausibly disagree.
    const alphabet = [...' \t\n-_.aZ9!/\0'];
    function* triples() {
      for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) yield a + b + c;
    }
    expect(firstDivergence(triples(), 50)).toBeNull();
  });

  test('real titles, at both input windows in use (50 for learn, 80 for handoff)', () => {
    const titles = [
      '  Edge: Pattern / Replay  ',
      'Deploy checklist',
      'collision test pattern shared first line very long',
      'completely different pattern with own slug',
      'frontmatter contract pattern from HTTP learn',
      '...',
      '!!!',
      '---',
      'a'.repeat(200),
      'UPPER CASE TITLE With  Multiple   Spaces',
      'v26.7.25-alpha.1900 / rtk gain --history',
      '../../etc/passwd',
      'trailing hyphen -',
      '- leading hyphen',
    ];
    expect(firstDivergence(titles, 50)).toBeNull();
    expect(firstDivergence(titles, 80)).toBeNull();
  });

  test('the byte clamp cannot fire on ASCII at any window a caller uses', () => {
    // 120 bytes is above both windows, so an all-ASCII slug is never truncated by it.
    // This is the invariant the identity proof above silently depends on.
    for (const limit of [50, 80]) {
      expect(slugifyTitle('a b '.repeat(100), limit).length).toBeLessThanOrEqual(limit);
      expect(slugifyTitle('a b '.repeat(100), limit)).toBe(legacyTitle('a b '.repeat(100), limit));
    }
  });
});
