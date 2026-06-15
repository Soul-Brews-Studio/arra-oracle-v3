import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver falls back to none for unknown backend names', () => {
  trackEnv('ORACLE_EMBEDDER', 'mystery');

  expect(resolveEmbeddingProviderType()).toBe('none');
});
