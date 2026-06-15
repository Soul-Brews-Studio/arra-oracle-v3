import { expect, test } from 'bun:test';
import { parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';

test('remote embedder parser rejects non-numeric vector entries', () => {
  expect(() => parseRemoteEmbeddingResponse({ embeddings: [[1], ['bad']] }, 2)).toThrow(/number/);
});
