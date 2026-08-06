import { expect, test } from 'bun:test';
import {
  estimateEmbeddingCost,
  estimateEmbeddingCosts,
  estimateFallbackChainCost,
  isCostProvider,
} from '../../src/vector/cost-estimation.ts';

test('embedding cost estimates clamp unsafe counts and preserve explicit model only for matching provider', () => {
  const single = estimateEmbeddingCost({
    docs: 1_234.9,
    tokensPerDoc: 0,
    provider: 'openai',
    model: 'custom-openai',
  });
  const comparison = estimateEmbeddingCosts(single, ['openai', 'openai', 'gemini']);

  expect(single).toMatchObject({
    docs: 1234,
    tokensPerDoc: 1,
    totalTokens: 1234,
    model: 'custom-openai',
  });
  expect(comparison.openai?.model).toBe('custom-openai');
  expect(comparison.gemini?.model).toBe('text-embedding-004');
  expect(Object.keys(comparison)).toEqual(['openai', 'gemini']);
});

test('fallback cost estimates dedupe providers and summarize free chains', () => {
  const estimate = estimateFallbackChainCost(
    { docs: 10, tokensPerDoc: 500 },
    ['local', 'local', 'gemini'],
  );

  expect(estimate.providers).toEqual(['local', 'gemini']);
  expect(estimate.worstCaseUsd).toBe(0);
  expect(estimate.summary).toContain('stays free/local');
  expect(isCostProvider('cloudflare-ai')).toBe(true);
  expect(isCostProvider('bogus')).toBe(false);
});
