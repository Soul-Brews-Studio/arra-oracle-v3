import { expect, test } from 'bun:test';
import { parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';

test('remote embedder parser accepts a single embedding vector shape', () => {
  expect(parseRemoteEmbeddingResponse({ embedding: [5, 6] }, 1)).toEqual([[5, 6]]);
});
