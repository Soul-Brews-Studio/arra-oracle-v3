import { expect, test } from 'bun:test';
import { recommendEmbeddingModel } from '../../src/vector/cost-estimation.ts';

test('recommendEmbeddingModel follows Vector Section v2 corpus-size guidance', () => {
  expect(recommendEmbeddingModel(9_999, [])).toContain('Any configured');
  expect(recommendEmbeddingModel(50_000, ['gemini'])).toContain('Gemini free tier');
  expect(recommendEmbeddingModel(50_000, ['ollama'])).toContain('Ollama/local');
  expect(recommendEmbeddingModel(50_000, [])).toContain('OpenAI small');
  expect(recommendEmbeddingModel(100_001, ['openai'])).toContain('GPU acceleration');
});
