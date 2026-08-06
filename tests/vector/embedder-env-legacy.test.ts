import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver honors legacy ORACLE_EMBEDDING_PROVIDER first', () => {
  trackEnv('ORACLE_EMBEDDER', 'none');
  trackEnv('ORACLE_EMBEDDING_PROVIDER', 'ollama');

  expect(resolveEmbeddingProviderType()).toBe('ollama');
});
