import { describe, expect, test } from 'bun:test';
import { MemoryHealthPanel, MemorySignalBadges, heatLabel, lastRecalledLabel, memorySignalFor } from '../../../frontend/src/components/MemoryHealthPanel';
import { htmlFor } from '../_render';

describe('MemoryHealthPanel heat and recency signals', () => {
  test('normalizes backend and metadata heat-score variants', () => {
    expect(memorySignalFor({
      heat_score: 0.82,
      last_recalled: '2026-06-17T01:02:03.000Z',
      usage_count: 7,
    })).toEqual({
      heatScore: 0.82,
      lastRecalled: '2026-06-17T01:02:03.000Z',
      usageCount: 7,
      heatPending: false,
    });
    expect(memorySignalFor({ metadata: { heatScore: 72, lastAccessedAt: 1781659001234 } }).heatScore).toBe(0.72);
    expect(memorySignalFor({ ranking: { components: { heat: 0.64 } }, confidence: { usageCount: 5 } }).heatScore).toBe(0.64);
  });

  test('renders memory health summary and pending backend stub', () => {
    const html = htmlFor(<MemoryHealthPanel state="ready" results={[
      { heat_score: 0.8, last_recalled: '2026-06-17T00:00:00.000Z' },
      { id: 'pending-heat' },
    ]} />);

    expect(html).toContain('Memory health');
    expect(html).toContain('Heat and recency');
    expect(html).toContain('80%');
    expect(html).toContain('2026-06-17');
    expect(html).toContain('1 result missing heat-score');
  });

  test('renders per-result badges for heat-score and last-recalled', () => {
    const html = htmlFor(<MemorySignalBadges result={{ heatScore: 0.44, lastRecalledAt: '2026-06-10', usageCount: 3 }} />);

    expect(heatLabel(0.44)).toBe('44%');
    expect(lastRecalledLabel('2026-06-10T00:00:00.000Z')).toBe('2026-06-10');
    expect(html).toContain('heat-score 44%');
    expect(html).toContain('last-recalled 2026-06-10');
    expect(html).toContain('recalls 3');
  });
});
