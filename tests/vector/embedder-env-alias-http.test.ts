import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver treats http alias as remote', () => {
  trackEnv('ORACLE_EMBEDDER', 'http');

  expect(resolveEmbeddingProviderType()).toBe('remote');
});
