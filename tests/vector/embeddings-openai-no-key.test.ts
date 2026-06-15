import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { clearVectorEnv } from './helpers.ts';

test('openai embedder requires an API key before construction succeeds', () => {
  clearVectorEnv();

  expect(() => createEmbeddingProvider('openai')).toThrow(/OpenAI API key required/);
});
