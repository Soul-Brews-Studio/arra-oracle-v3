import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';
import { memoryPath } from '../../../frontend/src/routePaths';

describe('memory route helpers', () => {
  test('builds memory route URLs', () => {
    expect(memoryPath()).toBe('/memory');
    expect(memoryPath(' oracle memory ')).toBe('/memory?q=oracle+memory');
  });

  test('returns memory route chrome metadata', () => {
    expect(routeMeta('/memory')).toMatchObject({ title: 'Memory dashboard', eyebrow: 'Memory' });
    expect(routeMeta('/memory', '?q=oracle').description).toBe('Provenance, confidence, heat, valid-time, and recency signals for “oracle”.');
  });
});
