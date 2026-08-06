import { expect, test } from 'bun:test';
import { resolveEmbeddingModel } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder model resolver prefers explicit config before env fallback', () => {
  trackEnv('ORACLE_EMBEDDING_MODEL', 'env-model');

  expect(resolveEmbeddingModel()).toBe('env-model');
  expect(resolveEmbeddingModel('configured-model')).toBe('configured-model');
});
