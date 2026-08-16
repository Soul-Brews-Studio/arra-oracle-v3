/**
 * A learning written in a non-Latin script must never be lost.
 *
 * `src/tools/learn.ts` carried an inline copy of the slug logic that omitted
 * `learningSlug`'s `|| 'learning'` fallback. The regex keeps only `[a-z0-9\s-]`,
 * so a wholly non-ASCII pattern slugged to the empty string:
 *
 *   'ทดสอบภาษาไทย'  -> ''      'Кириллица' -> ''
 *   '日本語のテスト'   -> ''      'mixed ไทย text' -> 'mixed-text'  (survived — has ASCII)
 *
 * The file became `<date>_.md`, and the SECOND such learning on the same day hit
 * `throw new Error('File already exists')`. The caller is an AI, which does not
 * retry — so the learning was **silently and permanently lost**. Thai is the
 * primary working language here, so this fired most days. See #2819.
 *
 * Both halves are required. The fallback alone makes every non-ASCII learning
 * slug to `learning`, which then collides with itself on the second one — the
 * same data loss with a different filename.
 *
 * Third half, added later: the fallback and the collision guard stop the LOSS but
 * still throw the title away, and `'mixed ไทย text' -> 'mixed-text'` shows the
 * failure mode that never goes red — a filename that looks right and no longer
 * describes its document. The slug rule now keeps \p{L}\p{N}\p{M} from any script
 * (`src/util/slug.ts`), so the assertions below moved with it. See PR #2934.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dateSlug, learningSlug, uniqueTail } from '../../../src/learn/markdown.ts';

const NON_ASCII = ['ทดสอบภาษาไทย', 'บันทึกที่สอง', '日本語のテスト', 'Кириллица', '한국어 테스트'];

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'learn-non-ascii-'));
}

describe('non-ASCII learning slugs', () => {
  test('never produce an empty slug', () => {
    for (const pattern of NON_ASCII) {
      expect(learningSlug(pattern)).not.toBe('');
    }
  });

  test('ASCII patterns are unaffected', () => {
    expect(learningSlug('Deploy checklist')).toBe('deploy-checklist');
  });

  test('a mixed pattern keeps its Thai instead of dropping it', () => {
    // Was `'mixed-text'` — the Thai silently deleted from the middle of the name. The
    // exhaustive proof that ASCII-only input is untouched lives in
    // `tests/util/slug-ascii-identity.test.ts`. See PR #2934.
    expect(learningSlug('mixed ไทย text')).toBe('mixed-ไทย-text');
  });

  test('a punctuation-only pattern falls back rather than slugging to empty', () => {
    expect(learningSlug('...')).toBe('learning');
    expect(learningSlug('!!!')).toBe('learning');
  });

  test('a whitespace-only pattern is rejected upstream, not slugged', () => {
    // `handleLearn` already refuses an empty pattern with a usage message before
    // reaching here (learn.ts guards it), so throwing is the correct contract —
    // asserted so nobody "fixes" it into a silent fallback that writes a file
    // for input the caller never meant to save.
    expect(() => learningSlug('   ')).toThrow('pattern is required');
  });
});

describe('same-day collisions are suffixed, never dropped', () => {
  test('five non-ASCII learnings on one day produce five distinct files', () => {
    const dir = freshDir();
    const date = dateSlug(new Date());
    const written = NON_ASCII.map((pattern) => {
      const tail = uniqueTail(dir, date, learningSlug(pattern));
      const name = `${date}_${tail}.md`;
      writeFileSync(join(dir, name), 'x');
      return name;
    });

    expect(new Set(written).size).toBe(NON_ASCII.length);
    expect(readdirSync(dir)).toHaveLength(NON_ASCII.length);
  });

  test('identical ASCII patterns also get suffixed rather than colliding', () => {
    const dir = freshDir();
    const date = dateSlug(new Date());
    const first = uniqueTail(dir, date, learningSlug('Deploy checklist'));
    writeFileSync(join(dir, `${date}_${first}.md`), 'x');
    const second = uniqueTail(dir, date, learningSlug('Deploy checklist'));

    expect(first).toBe('deploy-checklist');
    expect(second).toBe('deploy-checklist-2');
  });

  test('the suffix search is bounded and still returns something unique', () => {
    // A pathological directory must not spin the caller, and must not lose data.
    const dir = freshDir();
    const date = dateSlug(new Date());
    for (let i = 1; i <= 3; i += 1) {
      writeFileSync(join(dir, `${date}_${i === 1 ? 'x' : `x-${i}`}.md`), 'x');
    }
    expect(uniqueTail(dir, date, 'x', 3)).toMatch(/^x-\d{10,}$/); // timestamp fallback
    expect(uniqueTail(dir, date, 'x', 10)).toBe('x-4');
  });

  test('a fresh day starts from the unsuffixed name again', () => {
    const dir = freshDir();
    writeFileSync(join(dir, '2020-01-01_learning.md'), 'x');
    expect(uniqueTail(dir, '2026-07-25', 'learning')).toBe('learning');
  });
});
