import { expect, test } from 'bun:test';
import { EMBEDDING_MODELS } from '../../src/vector/factory.ts';

test('legacy embedding model proxy supports in-operator checks', () => {
  expect('bge-m3' in EMBEDDING_MODELS).toBe(true);
});
