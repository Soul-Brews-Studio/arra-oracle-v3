import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';

test('vector store factory passes remote embedder config to qdrant adapters', () => {
  const store = createVectorStore({
    type: 'qdrant',
    collectionName: 'qdrant_remote',
    embeddingProvider: 'remote',
    embeddingUrl: 'http://embed.local',
    embeddingDimensions: 3,
  });

  expect(store.name).toBe('qdrant');
  expect((store as any).embedder.name).toBe('remote');
  expect((store as any).embedder.dimensions).toBe(3);
});
