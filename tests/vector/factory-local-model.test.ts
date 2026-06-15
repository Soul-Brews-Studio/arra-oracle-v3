import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';

test('vector store factory passes configured local embedding model to lancedb adapters', () => {
  const store = createVectorStore({
    type: 'lancedb',
    dataPath: '/tmp/arra-vector-test',
    embeddingProvider: 'local',
    embeddingModel: 'bge-m3',
  });

  expect((store as any).embedder.name).toBe('ollama');
  expect((store as any).embedder.dimensions).toBe(1024);
});
