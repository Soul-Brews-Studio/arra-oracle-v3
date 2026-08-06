import { describe, expect, test } from 'bun:test';
import { memoryDashboardSummary, memoryToSignalResult, percentText, validTimeWindow } from '../../../frontend/src/memoryDashboard';

const memories = [{
  id: 'm1',
  content: 'Memory one',
  title: 'One',
  source: 'vault/one.md',
  tags: ['kb'],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  validFrom: '2026-06-01T00:00:00.000Z',
  validTo: '2026-07-01T00:00:00.000Z',
  confidence: { score: 0.8, label: 'high', usageCount: 4, components: { provenance: 1, usage: 0.5 } },
  ranking: { score: 0.77, components: { heat: 0.6, validTime: 0.9 } },
}, {
  id: 'm2',
  content: 'Memory two',
  createdAt: '2026-06-03T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
  confidence: { score: 0.4, label: 'low', components: { provenance: 0.2, usage: 0 } },
}] as const;

describe('memory dashboard helpers', () => {
  test('summarizes provenance, heat, confidence, and valid-time signals', () => {
    const summary = memoryDashboardSummary([...memories]);
    expect(summary.total).toBe(2);
    expect(percentText(summary.sourceCoverage)).toBe('50%');
    expect(percentText(summary.avgConfidence)).toBe('60%');
    expect(percentText(summary.avgHeat)).toBe('30%');
    expect(summary.validWindowCount).toBe(1);
    expect(validTimeWindow(memories[0])).toBe('valid 2026-06-01 → 2026-07-01');
    expect(memoryToSignalResult(memories[0]).memorySource).toBe('vault/one.md');
  });
});
