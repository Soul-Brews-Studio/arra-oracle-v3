import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';

test('vector store factory keeps Chroma as the default fallback adapter branch', () => {
  const store = createVectorStore({ type: 'chroma', collectionName: 'chroma_collection' });

  expect(store.name).toBe('chroma');
});
