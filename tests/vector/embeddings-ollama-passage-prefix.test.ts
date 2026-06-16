import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('ollama embedder prefixes BGE passage prompts', async () => {
  let prompt = '';
  const target = startServer(async (req) => {
    prompt = ((await req.json()) as any).input[0];
    return Response.json({ embedding: [1, 2] });
  });
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'bge-m3' });

  await provider.embed(['chunk'], 'passage');

  expect(prompt).toBe('passage: chunk');
});
