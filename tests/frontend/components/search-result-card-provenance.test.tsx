import { describe, expect, test } from 'bun:test';
import { SearchResultCard } from '../../../frontend/src/components/SearchResultCard';
import { htmlFor } from '../_render';

describe('SearchResultCard provenance signals', () => {
  test('renders source, confidence, and heat with accessible meters', () => {
    const html = htmlFor(
      <SearchResultCard
        result={{
          id: 'memory-1',
          content: 'Oracle memory with source and retrieval history.',
          title: 'Proven memory',
          source: 'hybrid',
          source_file: 'vault/session.md',
          score: 0.71,
          memorySource: 'vault:session.md',
          usageCount: 7,
          matches: [{ collection: 'bge-m3', rank: 1, score: 0.91 }],
          confidence: {
            score: 0.82,
            label: 'high',
            freshness: 0.88,
            usageCount: 7,
            components: { match: 0.91, freshness: 0.88, provenance: 1, usage: 0.69 },
          },
        }}
      />,
    );

    expect(html).toContain('Memory provenance and confidence');
    expect(html).toContain('vault:session.md');
    expect(html).toContain('confidence 82% · high');
    expect(html).toContain('heat 69%');
    expect(html).toContain('provenance 100%');
    expect(html).toContain('aria-valuenow="82"');
    expect(html).toContain('aria-valuenow="69"');
  });

  test('renders superseded badge with replacement link', () => {
    const html = htmlFor(
      <SearchResultCard
        result={{
          id: 'legacy',
          content: 'Legacy memory.',
          source_file: 'vault/legacy.md',
          superseded: { by: 'current-doc', at: '2026-06-16T10:00:00.000Z', reason: 'newer source' },
        }}
      />,
    );

    expect(html).toContain('superseded on 2026-06-16 → doc current-doc');
    expect(html).toContain('href="/vector/results?q=current-doc"');
    expect(html).toContain('newer source');
  });
});
