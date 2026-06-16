import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { clearVectorEnv } from './helpers.ts';

test('embedder resolver defaults to none when no env or config selects a backend', () => {
  clearVectorEnv();

  expect(resolveEmbeddingProviderType()).toBe('none');
});
