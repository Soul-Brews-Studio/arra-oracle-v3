import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('ollama embedder surfaces HTTP errors from the local embedding server', async () => {
  const target = startServer(() => new Response('ollama down', { status: 500 }));
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'nomic-embed-text' });

  await expect(provider.embed(['hello'])).rejects.toThrow(/Ollama API error \(500\): ollama down/);
});
