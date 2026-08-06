import { expect, test } from 'bun:test';
import { EMBEDDING_MODELS } from '../../src/vector/factory.ts';

test('legacy embedding model proxy enumerates configured model keys', () => {
  expect(Object.keys(EMBEDDING_MODELS)).toContain('bge-m3');
});
