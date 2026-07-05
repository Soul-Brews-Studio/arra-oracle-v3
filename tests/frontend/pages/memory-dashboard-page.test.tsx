import { describe, expect, test } from 'bun:test';
import { MemoryDashboardContent } from '../../../frontend/src/pages/MemoryDashboardPage';
import { htmlFor } from '../_render';

const items = [{
  id: 'mem-1',
  title: 'Source-backed memory',
  content: 'A sourced memory with strong provenance, heat, and a bounded valid-time window.',
  tags: ['provenance'],
  source: 'vault/source.md',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  validFrom: '2026-06-01T00:00:00.000Z',
  validTo: '2026-06-30T00:00:00.000Z',
  confidence: { score: 0.86, label: 'high', usageCount: 8, freshness: 0.9, components: { match: 0.88, freshness: 0.9, provenance: 1, usage: 0.7 } },
  ranking: { score: 0.82, components: { match: 0.88, confidence: 0.86, heat: 0.7, validTime: 0.92 } },
}];

describe('MemoryDashboardContent', () => {
  test('renders one Studio view for memory confidence signals', () => {
    const html = htmlFor(<MemoryDashboardContent items={items} total={1} asOf="2026-06-17T00:00:00.000Z" state="ready" />);
    expect(html).toContain('Memory dashboard');
    expect(html).toContain('class="glass rounded-3xl');
    expect(html).toContain('Source coverage');
    expect(html).toContain('confidence 86% · high');
    expect(html).toContain('heat 70%');
    expect(html).toContain('valid 2026-06-01 → 2026-06-30');
    expect(html).toContain('Valid-time fit');
  });
});
