import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('routeMeta search/metrics route titles', () => {
  test('maps /search to search metadata', () => {
    const meta = routeMeta('/search');
    expect(meta.title).toBe('Search');
    expect(meta.eyebrow).toBe('Search');
  });

  test('maps /metrics to metrics metadata', () => {
    const meta = routeMeta('/metrics');
    expect(meta.title).toBe('Runtime metrics');
    expect(meta.eyebrow).toBe('Metrics');
  });
});
