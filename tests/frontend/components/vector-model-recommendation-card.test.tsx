import { describe, expect, test } from 'bun:test';
import { VectorModelRecommendationCard } from '../../../frontend/src/components/VectorModelRecommendationCard';
import { htmlFor } from '../_render';

const estimate = {
  docs: 34_822,
  tokensPerDoc: 500,
  totalTokens: 17_411_000,
  provider: 'openai',
  model: 'text-embedding-3-small',
  estimatedUsd: 0.3482,
  formula: '34,822 docs × ~500 tokens/doc ≈ 17.4M tokens',
  note: 'Estimate only.',
  recommendation: 'Gemini free tier is recommended before paid remote embedding.',
  availableProviders: ['gemini', 'ollama'],
  fallbackSummary: 'Fallback chain ollama → gemini → openai worst-case remote spend: $0.3482.',
  providerEstimates: {
    openai: { model: 'text-embedding-3-small', estimatedUsd: 0.3482 },
    gemini: { model: 'text-embedding-004', estimatedUsd: 0 },
    ollama: { model: 'nomic-embed-text', estimatedUsd: 0 },
  },
  trackingEndpoint: '/api/v1/vector/costs',
};

describe('VectorModelRecommendationCard', () => {
  test('renders model guidance, cost comparison, and tracking endpoint', () => {
    const html = htmlFor(<VectorModelRecommendationCard initialEstimate={estimate} />);

    expect(html).toContain('Model recommendation');
    expect(html).toContain('Gemini free tier is recommended');
    expect(html).toContain('34,822 docs × ~500 tokens/doc ≈ 17.4M tokens');
    expect(html).toContain('gemini, ollama available');
    expect(html).toContain('Fallback chain ollama');
    expect(html).toContain('openai');
    expect(html).toContain('$0.3482');
    expect(html).toContain('gemini');
    expect(html).toContain('Free / local');
    expect(html).toContain('/api/v1/vector/costs');
  });
});
