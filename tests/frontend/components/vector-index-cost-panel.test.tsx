import { describe, expect, test } from 'bun:test';
import { VectorIndexCostPanel } from '../../../frontend/src/components/VectorIndexCostPanel';
import { htmlFor } from '../_render';

describe('VectorIndexCostPanel', () => {
  test('renders free/local estimates and zero-usage copy', () => {
    const html = htmlFor(
      <VectorIndexCostPanel
        initialCostEstimate={{ formula: 'local model estimate', provider: 'ollama', estimatedUsd: 0, recommendation: 'Use local embeddings for smoke tests.' }}
        initialCostTracking={{ breakdown: { daily: { inputTokens: 0, apiCalls: 0, estimatedUsd: 0 } } }}
      />,
    );

    expect(html).toContain('Preflight cost before Index Now');
    expect(html).toContain('local model estimate · ollama: Free / local');
    expect(html).toContain('Use local embeddings for smoke tests.');
    expect(html).toContain('Live cost tracking');
    expect(html).toContain('0 tokens · 0 API calls · Free / local today');
    expect(html).toContain('No metered indexing usage recorded yet.');
  });
});
