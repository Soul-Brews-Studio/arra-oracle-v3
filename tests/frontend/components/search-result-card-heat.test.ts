import { describe, expect, test } from 'bun:test';
import { heatDescription, heatScore, sourceLabel } from '../../../frontend/src/components/searchResultView';

describe('SearchResultCard heat helpers', () => {
  test('derives heat from confidence usage and prefers memory source labels', () => {
    const result = {
      id: 'm1',
      content: 'memory',
      source_file: 'fallback.md',
      memorySource: 'vault:memory.md',
      confidence: { components: { usage: 0.42 }, usageCount: 3 },
    };

    expect(sourceLabel(result)).toBe('vault:memory.md');
    expect(heatScore(result)).toBe(0.42);
    expect(heatDescription(result)).toContain('3 retrievals');
    expect(heatScore({ id: 'ranked', content: 'memory', ranking: { components: { heat: 0.81 } } })).toBe(0.81);
  });
});
