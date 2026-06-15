import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver treats ollama-local alias as local', () => {
  trackEnv('ORACLE_EMBEDDER', 'ollama-local');

  expect(resolveEmbeddingProviderType()).toBe('local');
});
