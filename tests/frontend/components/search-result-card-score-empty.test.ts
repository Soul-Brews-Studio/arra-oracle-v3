import { describe, expect, test } from 'bun:test';
import { scoreLabel } from '../../../frontend/src/components/searchResultView';

describe('scoreLabel missing score', () => {
  test('returns null for missing scores', () => {
    expect(scoreLabel()).toBeNull();
  });
});
