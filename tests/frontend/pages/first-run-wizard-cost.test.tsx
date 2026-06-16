import { describe, expect, test } from 'bun:test';
import { FirstRunWizard } from '../../../frontend/src/pages/FirstRunWizard';
import { htmlFor } from '../_render';

const rows = [
  {
    key: 'bge-m3',
    collection: 'oracle_bge_m3',
    model: 'BAAI/bge-m3',
    provider: 'ollama',
    adapter: 'lancedb' as const,
    primary: true,
    enabled: true,
    count: 34822,
  },
];

const cost = {
  docs: 34822,
  tokensPerDoc: 800,
  totalTokens: 27857600,
  provider: 'gemini',
  model: 'text-embedding-004',
  estimatedUsd: 0,
  formula: '34,822 docs × 800 tokens/doc = 27,857,600 tokens',
  note: 'Gemini text-embedding-004 is free within current public pricing; verify quotas before bulk indexing.',
  recommendation: 'Use Gemini free tier for this medium corpus, with Ollama fallback for retries.',
};

describe('FirstRunWizard cost review step', () => {
  test('shows cost estimate and recommendation before indexing', () => {
    const html = htmlFor(<FirstRunWizard rows={rows} onRefresh={() => {}} initialStep={2} initialCost={cost} />);
    expect(html).toContain('Estimated embedding cost');
    expect(html).toContain('34,822 docs');
    expect(html).toContain('gemini / text-embedding-004');
    expect(html).toContain('Recommendation:');
    expect(html).toContain('Use Gemini free tier');
    expect(html).toContain('Start indexing');
  });
});
