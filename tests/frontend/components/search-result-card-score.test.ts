import { describe, expect, test } from 'bun:test';
import { scoreLabel } from '../../../frontend/src/components/searchResultView';

describe('scoreLabel', () => {
  test('formats numeric scores as rounded percentages', () => {
    expect(scoreLabel(0.876)).toBe('88%');
  });
});
