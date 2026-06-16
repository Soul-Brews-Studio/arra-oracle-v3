import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { clearVectorEnv } from './helpers.ts';

test('remote embedder reports FTS fallback when no endpoint URL is configured', async () => {
  clearVectorEnv();
  const provider = createEmbeddingProvider('remote', 'bge-m3');

  await expect(provider.embed(['alpha'])).rejects.toThrow(/ORACLE_EMBEDDER_URL is unset/);
});
