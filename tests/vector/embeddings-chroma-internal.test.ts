import { expect, test } from 'bun:test';
import { ChromaDBInternalEmbeddings } from '../../src/vector/embeddings.ts';

test('chroma internal embedder refuses direct embedding calls', async () => {
  const provider = new ChromaDBInternalEmbeddings();

  expect(provider.name).toBe('chromadb-internal');
  await expect(provider.embed(['alpha'])).rejects.toThrow(/ChromaDB handles embeddings/);
});
