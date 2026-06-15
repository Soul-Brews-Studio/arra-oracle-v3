import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('ollama embedder uses qwen3 instruction prompts for queries', async () => {
  let prompt = '';
  const target = startServer(async (req) => {
    prompt = ((await req.json()) as any).prompt;
    return Response.json({ embedding: [1] });
  });
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'qwen3-embedding' });

  await provider.embed(['ถามหา'], 'query');

  expect(prompt).toContain('Instruct: Given a search query');
  expect(prompt).toContain('Query: ถามหา');
});
