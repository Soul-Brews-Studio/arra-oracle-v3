import { expect, test } from 'bun:test';
import { resolveEmbeddingFallbackChain } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder fallback chain parses configured provider order', () => {
  expect(resolveEmbeddingFallbackChain(['ollama', 'gemini', 'openai'])).toEqual(['ollama', 'gemini', 'openai']);
});

test('embedder fallback chain can come from environment', () => {
  try {
    trackEnv('ORACLE_EMBEDDER_CHAIN', 'ollama,gemini,openai');
    expect(resolveEmbeddingFallbackChain()).toEqual(['ollama', 'gemini', 'openai']);
  } finally {
    delete process.env.ORACLE_EMBEDDER_CHAIN;
  }
});
