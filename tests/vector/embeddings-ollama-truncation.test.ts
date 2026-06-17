import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('ollama embedder truncates very long prompts before embedding', async () => {
  let prompt = '';
  const target = startServer(async (req) => {
    prompt = ((await req.json()) as any).input[0];
    return Response.json({ embedding: [1] });
  });
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'nomic-embed-text' });

  await provider.embed(['x'.repeat(2_100)]);

  expect(prompt).toHaveLength(2_000);
});
