/**
 * Unit tests for parseDate() and formatTempoLabel() — pure functions in schedule.ts.
 *
 * Covers: ISO passthrough, English month names, Thai abbreviations,
 * relative dates (today/tomorrow), slash format, fallback behaviour,
 * and Three Tempos label formatting (allegro/andante/adagio).
 */

import { describe, it, expect } from 'bun:test';
import { parseDate, formatTempoLabel } from '../schedule.ts';

/** Helper: format a Date as YYYY-MM-DD in local timezone (mirrors fmtLocal). */
function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const THIS_YEAR = new Date().getFullYear();

// ============================================================================
// ISO format passthrough
// ============================================================================

describe('parseDate — ISO format passthrough', () => {
  it('should return YYYY-MM-DD as-is', () => {
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
  });

  it('should return other valid ISO dates unchanged', () => {
    expect(parseDate('2025-12-31')).toBe('2025-12-31');
    expect(parseDate('2026-01-01')).toBe('2026-01-01');
  });
});

// ============================================================================
// English month names
// ============================================================================

describe('parseDate — English month names', () => {
  it('should parse "5 Mar" (day first, abbreviated)', () => {
    expect(parseDate('5 Mar')).toBe(`${THIS_YEAR}-03-05`);
  });

  it('should parse "March 5" (month first, full name)', () => {
    expect(parseDate('March 5')).toBe(`${THIS_YEAR}-03-05`);
  });

  it('should parse "5 March 2026" (day month year)', () => {
    expect(parseDate('5 March 2026')).toBe('2026-03-05');
  });

  it('should parse "Dec 25" (month first, abbreviated)', () => {
    expect(parseDate('Dec 25')).toBe(`${THIS_YEAR}-12-25`);
  });

  it('should parse "January 1, 2027" (month first with comma and year)', () => {
    expect(parseDate('January 1, 2027')).toBe('2027-01-01');
  });
});

// ============================================================================
// Thai month abbreviations
// ============================================================================

describe('parseDate — Thai month abbreviations', () => {
  it('should parse "5 มี.ค." (formal Thai abbreviation with dots)', () => {
    expect(parseDate('5 มี.ค.')).toBe(`${THIS_YEAR}-03-05`);
  });

  it('should parse "5 มีค" (informal Thai abbreviation without dots)', () => {
    expect(parseDate('5 มีค')).toBe(`${THIS_YEAR}-03-05`);
  });

  it('should parse "15 ก.พ." (February, formal)', () => {
    expect(parseDate('15 ก.พ.')).toBe(`${THIS_YEAR}-02-15`);
  });

  it('should parse "28 ธ.ค." (December, formal)', () => {
    expect(parseDate('28 ธ.ค.')).toBe(`${THIS_YEAR}-12-28`);
  });
});

// ============================================================================
// Relative dates
// ============================================================================

describe('parseDate — relative dates', () => {
  it('should parse "today" to current date', () => {
    const expected = fmtLocal(new Date());
    expect(parseDate('today')).toBe(expected);
  });

  it('should parse "Today" (case-insensitive)', () => {
    const expected = fmtLocal(new Date());
    expect(parseDate('Today')).toBe(expected);
  });

  it('should parse "tomorrow" to the next day', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const expected = fmtLocal(d);
    expect(parseDate('tomorrow')).toBe(expected);
  });

  it('should parse "TOMORROW" (case-insensitive)', () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const expected = fmtLocal(d);
    expect(parseDate('TOMORROW')).toBe(expected);
  });
});

// ============================================================================
// Slash format (DD/MM and DD/MM/YYYY)
// ============================================================================

describe('parseDate — slash format', () => {
  it('should parse "5/3" as day 5, month 3', () => {
    expect(parseDate('5/3')).toBe(`${THIS_YEAR}-03-05`);
  });

  it('should parse "5/3/2026" as day 5, month 3, year 2026', () => {
    expect(parseDate('5/3/2026')).toBe('2026-03-05');
  });

  it('should parse "25/12" as day 25, month 12', () => {
    expect(parseDate('25/12')).toBe(`${THIS_YEAR}-12-25`);
  });

  it('should parse "1/1/27" as two-digit year (2027)', () => {
    expect(parseDate('1/1/27')).toBe('2027-01-01');
  });

  it('should parse dash-separated "5-3" same as slash', () => {
    expect(parseDate('5-3')).toBe(`${THIS_YEAR}-03-05`);
  });
});

// ============================================================================
// Invalid/unrecognized input — fallback to today
// ============================================================================

describe('parseDate — fallback behaviour', () => {
  it('should fall back to today for unrecognized text', () => {
    const expected = fmtLocal(new Date());
    expect(parseDate('some random text')).toBe(expected);
  });

  it('should fall back to today for empty-ish input', () => {
    const expected = fmtLocal(new Date());
    expect(parseDate('   ')).toBe(expected);
  });

  it('should fall back to today for gibberish', () => {
    const expected = fmtLocal(new Date());
    expect(parseDate('xyz123')).toBe(expected);
  });
});

// ============================================================================
// formatTempoLabel — Three Tempos (Xikp Oracle)
// ============================================================================

describe('formatTempoLabel — Three Tempos', () => {
  it('should return emoji label for allegro (Developer tempo)', () => {
    expect(formatTempoLabel('allegro')).toBe('⚡ allegro');
  });

  it('should return emoji label for andante (Runner tempo)', () => {
    expect(formatTempoLabel('andante')).toBe('🏃 andante');
  });

  it('should return emoji label for adagio (Musician tempo)', () => {
    expect(formatTempoLabel('adagio')).toBe('🎵 adagio');
  });

  it('should return empty string for null', () => {
    expect(formatTempoLabel(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(formatTempoLabel(undefined)).toBe('');
  });

  it('should return empty string for unknown tempo values', () => {
    expect(formatTempoLabel('presto')).toBe('');
    expect(formatTempoLabel('')).toBe('');
  });
});
