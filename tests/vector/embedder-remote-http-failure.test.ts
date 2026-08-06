import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('remote embedder reports FTS fallback when the HTTP endpoint fails', async () => {
  const target = startServer(() => new Response('down', { status: 503 }));
  const provider = createEmbeddingProvider('remote', 'bge-m3', { url: target });

  await expect(provider.embed(['alpha'])).rejects.toThrow(/Remote embedder unavailable.*FTS5 fallback/);
});
