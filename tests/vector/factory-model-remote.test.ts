import { expect, test } from 'bun:test';
import { createVectorStoreForModel } from '../../src/vector/factory.ts';

test('vector store factory honors remote embedder presets for model stores', () => {
  const store = createVectorStoreForModel({
    collection: 'remote_collection',
    model: 'bge-m3',
    adapter: 'lancedb',
    dataPath: '/tmp/arra-vector-test',
    embedder: { backend: 'remote', url: 'http://embed.local', dimensions: 2 },
  });

  expect((store as any).embedder.name).toBe('remote');
  expect((store as any).embedder.dimensions).toBe(2);
});
