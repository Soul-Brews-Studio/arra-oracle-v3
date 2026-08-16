/**
 * A title written in a non-Latin script survives into its slug.
 *
 * The loud half of this bug — a pure-Thai title slugging to `''`, so the file was
 * `<date>_.md` and the second one of the day collided — was fixed in #2819 by adding a
 * `'learning'` fallback and a `-2`/`-3` collision guard. That stopped the data loss and
 * left the title thrown away.
 *
 * The quiet half is the dangerous one, because it looks like it worked:
 *
 *   'ทดสอบ fallback ไทยล้วน' -> 'fallback'
 *
 * A plausible ASCII filename, and the actual title gone. Nothing goes red, nothing 500s,
 * and the name no longer describes the document. That is what this file pins.
 *
 * Reported in PR #2934 by @yimtheppariyapol.
 */
import { describe, expect, test } from 'bun:test';
import { SLUG_MAX_BYTES, slugifySnippet, slugifyTitle } from '../../src/util/slug.ts';

const utf8 = (value: string) => new TextEncoder().encode(value).length;

describe('the reported cases', () => {
  test('a wholly Thai title is kept, not emptied', () => {
    expect(slugifyTitle('ทดสอบไทยล้วนไม่มีอังกฤษ', 50)).toBe('ทดสอบไทยล้วนไม่มีอังกฤษ');
  });

  test('a mixed title keeps BOTH scripts, not just the Latin token', () => {
    // The old rule returned 'fallback' here — one surviving token masquerading as a slug.
    expect(slugifyTitle('ทดสอบ fallback ไทยล้วน', 50)).toBe('ทดสอบ-fallback-ไทยล้วน');
  });

  test('two different Thai titles no longer collide on one name', () => {
    const first = slugifyTitle('บันทึกแรกของวันนี้', 50);
    const second = slugifyTitle('บันทึกที่สองของวันนี้', 50);
    // Both were '' before, i.e. the same filename, i.e. what `uniqueTail` had to paper over.
    expect(first).not.toBe(second);
  });
});

describe('combining marks are part of the word', () => {
  test('Thai tone marks and below-vowels are kept', () => {
    // \p{M} is why: ้ (U+0E49) is Mn, not Lo. Dropping it spells a different word.
    expect(slugifyTitle('ล้วน', 50)).toBe('ล้วน');
    expect(slugifyTitle('ล้วน', 50)).not.toBe('ลวน');
  });

  test('Devanagari matras are kept', () => {
    expect(slugifyTitle('नमस्ते दुनिया', 50)).toBe('नमस्ते-दुनिया');
  });

  test('other scripts round-trip too', () => {
    expect(slugifyTitle('日本語のテスト', 50)).toBe('日本語のテスト');
    expect(slugifyTitle('Проверка кириллицы', 50)).toBe('проверка-кириллицы');
    expect(slugifyTitle('한국어 테스트', 50)).toBe('한국어-테스트');
  });
});

describe('what is still dropped', () => {
  test('emoji and symbols are not letters and do not reach a filename', () => {
    expect(slugifyTitle('🌟🔥', 50)).toBe('');
    expect(slugifyTitle('alpha 🌟 beta', 50)).toBe('alpha-beta');
  });

  test('path separators, dots and controls cannot survive — the traversal guard holds', () => {
    for (const attack of ['../../etc/passwd', '..\\..\\windows', 'a/b', 'a\0b', 'a‮b']) {
      const slug = slugifyTitle(attack, 80);
      expect(slug).not.toContain('/');
      expect(slug).not.toContain('\\');
      expect(slug).not.toContain('.');
      expect(slug).not.toContain('\0');
    }
  });

  test('a title with no letters or digits still slugs to nothing, leaving the caller its fallback', () => {
    // Deliberately NOT a content hash: '!!!' is ASCII, its slug today is the caller's
    // fallback word, and the collision guards (`uniqueTail`, `writeHandoffFile`'s -N
    // loop) already stop two of those overwriting each other. A hash would change ASCII
    // output to buy nothing and cost legibility.
    expect(slugifyTitle('!!!', 50)).toBe('');
    expect(slugifyTitle('...', 50)).toBe('');
  });
});

describe('a slug still fits in a filename', () => {
  test('a long Thai title is clamped by BYTES, not characters', () => {
    // Thai is 3 UTF-8 bytes per character. Without a byte clamp the 80-character window
    // `safeHandoffSlug` uses yields 240 bytes; `<date>_<time>_<slug>.md` is then 260,
    // over the 255-byte ext4/APFS limit — ENAMETOOLONG, a fix introducing a new outage.
    const slug = slugifyTitle('ท'.repeat(200), 80);
    expect(utf8(slug)).toBeLessThanOrEqual(SLUG_MAX_BYTES);
    expect(utf8(`2026-08-16_21-30_${slug}.md`)).toBeLessThan(255);
  });

  test('the clamp never leaves a half-written character or a trailing separator', () => {
    const slug = slugifyTitle('ก้'.repeat(200), 80);
    expect(slug).toBe(slug.normalize()); // no lone surrogate, no invalid sequence
    expect(slug.endsWith('-')).toBe(false);
    expect(slugifyTitle(`${'ก '.repeat(200)}`, 80).endsWith('-')).toBe(false);
  });

  test('a mark that legitimately ends a word is NOT stripped', () => {
    // The clamp cuts on a code-point boundary and a mark always follows its base, so it
    // can drop a mark but never orphan one. An unconditional trailing-\p{M} strip would
    // therefore only ever corrupt real words: दुनिया ends in a spacing matra.
    expect(slugifyTitle('दुनिया', 50).endsWith('ा')).toBe(true);
  });

  test('a 4-byte code point is never split across the clamp', () => {
    const slug = slugifyTitle('𠜎'.repeat(200), 80); // CJK ext B, 4 bytes each
    expect(utf8(slug)).toBeLessThanOrEqual(SLUG_MAX_BYTES);
    expect([...slug].every((ch) => ch.codePointAt(0)! > 0xffff)).toBe(true);
  });
});

describe('the snippet rule widens the same way', () => {
  test('Thai survives the trace-style rule too', () => {
    expect(slugifySnippet('ทดสอบ trace ไทย', 50)).toBe('ทดสอบ-trace-ไทย');
  });

  test('punctuation still separates rather than disappearing', () => {
    // The one behavioural difference from slugifyTitle, kept on purpose.
    expect(slugifySnippet('fix: the parser.  again', 50)).toBe('fix-the-parser-again');
    expect(slugifyTitle('fix: the parser.  again', 50)).toBe('fix-the-parser-again');
    expect(slugifySnippet('a.b', 50)).toBe('a-b');
    expect(slugifyTitle('a.b', 50)).toBe('ab');
  });
});
