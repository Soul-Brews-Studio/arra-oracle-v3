import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { clearVectorEnv } from './helpers.ts';

test('none embedder fails fast so callers can keep FTS fallback', async () => {
  clearVectorEnv();
  const provider = createEmbeddingProvider();

  expect(provider.name).toBe('none');
  await expect(provider.embed(['hello'])).rejects.toThrow(/FTS5 fallback/);
});
