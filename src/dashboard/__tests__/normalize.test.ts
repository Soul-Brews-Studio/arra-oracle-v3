import { describe, expect, test } from 'bun:test';
import { normalizeActivityDays, normalizeGrowthPeriod, normalizeSessionSince, parseConceptList, safeIsoTime } from '../normalize.ts';

describe('dashboard normalization helpers', () => {
  test('strictly normalizes bounded days and since timestamps', () => {
    expect(normalizeActivityDays(' 30 ')).toBe(30);
    expect(normalizeActivityDays('30days')).toBe(7);
    expect(normalizeActivityDays('0')).toBe(7);
    expect(normalizeActivityDays('9999')).toBe(365);
    expect(normalizeSessionSince('123abc', 1_000_000)).toBe(1_000_000 - 86_400_000);
    expect(normalizeSessionSince('0', 1_000_000)).toBe(0);
  });

  test('normalizes growth periods and concept arrays defensively', () => {
    expect(normalizeGrowthPeriod(' Quarter ')).toBe('quarter');
    expect(normalizeGrowthPeriod('forever')).toBe('week');
    expect(parseConceptList('[" alpha ","alpha",42,null,"beta"]')).toEqual(['alpha', 'beta']);
    expect(parseConceptList('{"not":"array"}')).toEqual([]);
    expect(parseConceptList('not-json')).toEqual([]);
  });

  test('safeIsoTime never throws on invalid timestamps', () => {
    expect(safeIsoTime(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(safeIsoTime('not-a-time')).toBe('1970-01-01T00:00:00.000Z');
  });
});
