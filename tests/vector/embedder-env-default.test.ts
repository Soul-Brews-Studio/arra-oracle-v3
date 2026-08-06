import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderSelection, resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { clearVectorEnv } from './helpers.ts';

test('embedder resolver auto-selects ollama when no env or config selects a backend', () => {
  clearVectorEnv();

  expect(resolveEmbeddingProviderType()).toBe('ollama');
  expect(resolveEmbeddingProviderSelection()).toMatchObject({
    provider: 'ollama',
    source: 'auto-default',
    explicit: false,
  });
});

test('embedder resolver keeps explicit none disabled', () => {
  clearVectorEnv();
  process.env.ORACLE_EMBEDDER = 'none';

  expect(resolveEmbeddingProviderSelection()).toMatchObject({
    provider: 'none',
    source: 'env',
    explicit: true,
  });
});
