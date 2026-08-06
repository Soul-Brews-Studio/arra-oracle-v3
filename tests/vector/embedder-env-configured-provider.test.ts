import { expect, test } from 'bun:test';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { trackEnv } from './helpers.ts';

test('embedder resolver lets explicit config override environment', () => {
  trackEnv('ORACLE_EMBEDDER', 'none');

  expect(resolveEmbeddingProviderType('remote')).toBe('remote');
});
