/**
 * Unit tests for slugifyPattern.
 */

import { describe, it, expect } from 'bun:test';
import { slugifyPattern } from '../slug.ts';

// ============================================================================
// slugifyPattern
// ============================================================================

describe('slugifyPattern', () => {
  it('should slugify a Latin pattern', () => {
    expect(slugifyPattern('Ascii Leading Title')).toBe('ascii-leading-title');
  });

  it('should keep non-Latin scripts instead of dropping them', () => {
    // Previously collapsed to '' because the character class was [a-z0-9\s-].
    expect(slugifyPattern('ทดสอบไทยล้วน')).toBe('ทดสอบไทยล้วน');
    expect(slugifyPattern('日本語のタイトル')).toBe('日本語のタイトル');
  });

  it('should keep the non-Latin words in a mixed pattern', () => {
    expect(slugifyPattern('ทดสอบ mixed title')).toBe('ทดสอบ-mixed-title');
  });

  it('should give distinct slugs to distinct non-Latin patterns', () => {
    // The collision this guards: both used to slugify to '', so the second write
    // hit `UNIQUE constraint failed: oracle_documents.id`.
    expect(slugifyPattern('บทเรียนแรก')).not.toBe(slugifyPattern('บทเรียนที่สอง'));
  });

  it('should never return an empty slug', () => {
    expect(slugifyPattern('...')).not.toBe('');
    expect(slugifyPattern('🧦🧦')).not.toBe('');
    expect(slugifyPattern('   ')).not.toBe('');
  });

  it('should drop punctuation but keep letters and numbers', () => {
    expect(slugifyPattern('v2: the "fix" (final)!')).toBe('v2-the-fix-final');
  });
});
