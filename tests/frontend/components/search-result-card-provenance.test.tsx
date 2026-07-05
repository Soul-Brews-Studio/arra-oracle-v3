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
});
