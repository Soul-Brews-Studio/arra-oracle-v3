import { expect, test } from 'bun:test';
import { parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';

test('remote embedder parser rejects embedding counts that do not match input count', () => {
  expect(() => parseRemoteEmbeddingResponse({ embeddings: [[1]] }, 2)).toThrow(/count/);
});
