import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('ollama embedder prefixes BGE query prompts', async () => {
  let prompt = '';
  const target = startServer(async (req) => {
    prompt = ((await req.json()) as any).prompt;
    return Response.json({ embedding: [1, 2, 3] });
  });
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'bge-m3' });

  const vectors = await provider.embed(['hello'], 'query');

  expect(prompt).toBe('query: hello');
  expect(vectors).toEqual([[1, 2, 3]]);
  expect(provider.dimensions).toBe(3);
});
