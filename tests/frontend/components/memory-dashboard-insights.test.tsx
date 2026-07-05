import { describe, expect, test } from 'bun:test';
import { MemoryDashboardInsights, heatValue, supersedeEdge } from '../../../frontend/src/components/MemoryDashboardInsights';
import { htmlFor } from '../_render';

const results = [
  {
    id: 'hot',
    title: 'Hot memory',
    content: 'high confidence memory',
    score: 0.91,
    heat_score: 0.86,
    last_recalled: '2026-06-17T00:00:00.000Z',
    valid_time: '2026-06-01T00:00:00.000Z',
    valid_until: '2026-12-01T00:00:00.000Z',
    confidence: { score: 0.91, label: 'high' },
  },
  {
    id: 'old',
    title: 'Old memory',
    content: 'superseded memory',
    score: 0.44,
    ranking: { components: { heat: 0.32 } },
    superseded_by: 'new-memory',
    superseded_at: '2026-06-10T00:00:00.000Z',
    superseded_reason: 'newer pattern',
  },
];

describe('MemoryDashboardInsights', () => {
  test('renders heatmap, confidence, valid-time, and supersede sections', () => {
    const html = htmlFor(<MemoryDashboardInsights results={results} />);

    expect(html).toContain('Heat heatmap');
    expect(html).toContain('aria-label="Memory heatmap cells"');
    expect(html).toContain('Hot memory heat 86%');
    expect(html).toContain('Confidence bars');
    expect(html).toContain('aria-valuenow="91"');
    expect(html).toContain('Valid-time timeline');
    expect(html).toContain('2026-06-01 → 2026-12-01');
    expect(html).toContain('Supersede-chain viewer');
    expect(html).toContain('Old memory → new-memory');
    expect(html).toContain('newer pattern');
  });

  test('normalizes ranking heat and supersede edges', () => {
    expect(heatValue(results[1])).toBe(0.32);
    expect(supersedeEdge(results[1])).toMatchObject({ from: 'Old memory', to: 'new-memory', reason: 'newer pattern' });
  });
});
