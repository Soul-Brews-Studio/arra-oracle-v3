import { expect, test } from 'bun:test';
import { parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';

test('remote embedder parser orders OpenAI-style data arrays by index', () => {
  expect(parseRemoteEmbeddingResponse({ data: [
    { index: 1, embedding: [3, 4] },
    { index: 0, embedding: [1, 2] },
  ] }, 2)).toEqual([[1, 2], [3, 4]]);
});
