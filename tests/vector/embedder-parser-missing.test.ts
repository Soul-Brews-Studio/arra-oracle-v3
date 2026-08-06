import { expect, test } from 'bun:test';
import { parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';

test('remote embedder parser rejects responses without embeddings', () => {
  expect(() => parseRemoteEmbeddingResponse({}, 1)).toThrow(/missing embeddings/);
});
