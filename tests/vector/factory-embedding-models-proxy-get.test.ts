import { expect, test } from 'bun:test';
import { EMBEDDING_MODELS } from '../../src/vector/factory.ts';

test('legacy embedding model proxy resolves model properties lazily', () => {
  expect(EMBEDDING_MODELS['bge-m3'].model).toBe('bge-m3');
});
