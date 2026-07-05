import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';

test('local embedder aliases to Ollama without network work at construction', () => {
  const provider = createEmbeddingProvider('local', 'nomic-embed-text');

  expect(provider.name).toBe('ollama');
  expect(provider.dimensions).toBe(768);
});
