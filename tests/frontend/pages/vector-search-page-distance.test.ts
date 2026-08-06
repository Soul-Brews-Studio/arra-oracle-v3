import { describe, expect, test } from 'bun:test';
import { distanceLabel, distancePercent } from '../../../frontend/src/pages/VectorSearchPage';

describe('VectorSearchPage distance helpers', () => {
  test('formats distance scores and inverse distance percentages', () => {
    const result = { distance: 0.25 };

    expect(distanceLabel(result)).toBe('0.250');
    expect(distancePercent(result)).toBe(87.5);
  });
});
