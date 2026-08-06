import { describe, expect, test } from 'bun:test';
import { cosineDistanceToSimilarity } from '../../vector/scoring.ts';

describe('cosineDistanceToSimilarity', () => {
  test('maps LanceDB cosine distance across the full 0..1 relevance range', () => {
    expect([0, 1, 2].map(cosineDistanceToSimilarity)).toEqual([1, 0.5, 0]);

    const scores = [0, 0.5, 1, 1.5, 2].map(cosineDistanceToSimilarity);
    expect(scores).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(Math.max(...scores)).toBeLessThanOrEqual(1);
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
  });

  test('does not saturate ordinary cosine distances near 0.99', () => {
    const scores = [0.2, 0.8, 1.6].map(cosineDistanceToSimilarity);

    expect(scores[0]).toBeCloseTo(0.9, 6);
    expect(scores[1]).toBeCloseTo(0.6, 6);
    expect(scores[2]).toBeCloseTo(0.2, 6);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(0.6);
  });

  test('clamps out-of-range adapter distances defensively', () => {
    expect(cosineDistanceToSimilarity(-1)).toBe(1);
    expect(cosineDistanceToSimilarity(3)).toBe(0);
  });
});
