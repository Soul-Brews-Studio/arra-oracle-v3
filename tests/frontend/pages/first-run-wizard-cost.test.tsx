import { describe, expect, test } from 'bun:test';
import { FirstRunWizard, detectFirstRunWizardResolution } from '../../../frontend/src/pages/FirstRunWizard';
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
  fallbackSummary: 'Fallback chain gemini → ollama stays free/local for this estimate.',
};

describe('FirstRunWizard cost review step', () => {
  test('defaults to sqlite-vec with no provider prompt when no config exists', () => {
    const html = htmlFor(<FirstRunWizard rows={[]} onRefresh={() => {}} initialStep={1} initialCost={cost} />);
    expect(html).toContain('detect() resolved sqlite-vec from first-run-default');
    expect(html).toContain('No provider prompt or provider choice is required');
    expect(html).toContain('Primary adapter: sqlite-vec');
  });

  test('detects returning users from existing indexed collections', () => {
    const resolution = detectFirstRunWizardResolution(rows, null);
    expect(resolution).toMatchObject({
      engine: 'lancedb',
      source: 'detect',
      returningUser: true,
      providerPrompt: false,
      wizard: 'optional',
      collection: 'oracle_bge_m3',
    });
  });

  test('shows cost estimate and recommendation before indexing', () => {
    const html = htmlFor(<FirstRunWizard rows={rows} onRefresh={() => {}} initialStep={2} initialCost={cost} />);
    expect(html).toContain('Estimated embedding cost');
    expect(html).toContain('34,822 docs');
    expect(html).toContain('gemini / text-embedding-004');
    expect(html).toContain('Recommendation:');
    expect(html).toContain('Use Gemini free tier');
    expect(html).toContain('Fallback chain gemini');
    expect(html).toContain('Start indexing');
  });

  test('shows dashboard and index manager links on the done step', () => {
    const html = htmlFor(<FirstRunWizard rows={rows} onRefresh={() => {}} initialStep={3} initialCost={cost} />);
    expect(html).toContain('Vector setup is underway');
    expect(html).toContain('Continue to dashboard');
    expect(html).toContain('href="/vector"');
    expect(html).toContain('Open Index Manager');
    expect(html).toContain('href="/vector/index"');
  });

});
