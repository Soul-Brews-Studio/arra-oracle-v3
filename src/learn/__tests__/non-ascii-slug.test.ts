/**
 * A non-ASCII learning must be saveable, and a second one the same day must not be lost (#2819).
 *
 * `learningSlug` strips to `[a-z0-9-]`, so a Thai, Japanese or Cyrillic pattern with no ASCII
 * word slugged to the **empty string**. Every such learning therefore collided on the same
 * filename, and the second one of any day was rejected — Nat's, in Thai, routinely.
 *
 * The fix has two halves and, until now, neither had a test for the reported symptom. The
 * existing coverage was `expect(learningSlug('!!!')).toBe('learning')`, which exercises the
 * fallback but says nothing about non-ASCII input, and `uniqueTail` had **no test at all**.
 *
 * Both halves are needed: the fallback alone makes every non-ASCII learning of a day slug
 * identically, which turns "empty slug" into "guaranteed collision". `uniqueTail` is what stops
 * that being a loss. Throwing is not an option — the caller is an AI that does not retry.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { learningSlug, uniqueTail } from '../markdown.ts';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'learn-slug-'));
  dirs.push(dir);
  return dir;
}

describe('a non-ASCII pattern never slugs to nothing', () => {
  const cases: Array<[string, string]> = [
    ['Thai', 'การทดสอบภาษาไทย'],
    ['Japanese', '日本語のテスト'],
    ['Cyrillic', 'Проверка кириллицы'],
    ['emoji only', '🌟🔥'],
    ['punctuation only', '!!!'],
  ];

  for (const [name, pattern] of cases) {
    test(`${name} produces a usable slug`, () => {
      const slug = learningSlug(pattern);
      // An empty slug is what produced the collision that lost the second learning.
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).not.toBe('');
    });
  }

  test('an ASCII word inside a Thai pattern is kept rather than discarded', () => {
    // Preferring the real token over the generic fallback keeps the filename meaningful.
    expect(learningSlug('การทดสอบภาษาไทยสำหรับ oracle')).toBe('oracle');
  });

  test('an ordinary ASCII pattern is unaffected', () => {
    expect(learningSlug('  Edge: Pattern / Replay  ')).toBe('edge-pattern-replay');
  });
});

describe('a second learning the same day is suffixed, not lost', () => {
  test('the first free tail is the bare slug', () => {
    expect(uniqueTail(tempDir(), '2026-07-27', 'learning')).toBe('learning');
  });

  test('an existing file pushes the next one to -2', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-07-27_learning.md'), '# one\n');
    expect(uniqueTail(dir, '2026-07-27', 'learning')).toBe('learning-2');
  });

  test('three Thai learnings in one day all get distinct filenames', () => {
    /**
     * The reported symptom, end to end. Every pure-Thai pattern slugs to the same fallback, so
     * without `uniqueTail` the second and third would overwrite or be rejected.
     */
    const dir = tempDir();
    const slug = learningSlug('การทดสอบภาษาไทย');
    const tails: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const tail = uniqueTail(dir, '2026-07-27', slug);
      tails.push(tail);
      writeFileSync(join(dir, `2026-07-27_${tail}.md`), `# ${i}\n`);
    }
    expect(new Set(tails).size).toBe(3);
  });

  test('a different day starts over at the bare slug', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-07-27_learning.md'), '# one\n');
    // The date is part of the filename, so yesterday's file must not push today's to -2.
    expect(uniqueTail(dir, '2026-07-28', 'learning')).toBe('learning');
  });

  test('it gives up on a timestamped tail rather than looping forever', () => {
    const dir = tempDir();
    for (let i = 1; i <= 3; i += 1) {
      writeFileSync(join(dir, `2026-07-27_${i === 1 ? 'learning' : `learning-${i}`}.md`), '#\n');
    }
    // max=3 exhausts the suffix range; the fallback must still be unique, never a throw.
    const tail = uniqueTail(dir, '2026-07-27', 'learning', 3);
    expect(tail.startsWith('learning-')).toBe(true);
    expect(tail).not.toBe('learning-2');
    expect(tail).not.toBe('learning-3');
  });
});
