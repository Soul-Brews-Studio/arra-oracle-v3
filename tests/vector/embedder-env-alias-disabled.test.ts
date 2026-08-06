import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver treats disabled alias as none', () => {
  trackEnv('ORACLE_EMBEDDER', 'disabled');

  expect(resolveEmbeddingProviderType()).toBe('none');
});
