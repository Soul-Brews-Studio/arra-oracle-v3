import { expect, test } from 'bun:test';
import { OllamaEmbeddings } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

function capture() {
  const seen: string[] = [];
  const target = startServer(async (req) => {
    seen.push(((await req.json()) as any).input[0]);
    return Response.json({ embeddings: [[1, 0, 0]] });
  });
  return { seen, target };
}

test('embeddinggemma models get their task prompts for queries and passages', async () => {
  const { seen, target } = capture();
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'embeddinggemma:ane-w8a16' });

  await provider.embed(['ค้นหา'], 'query');
  await provider.embed(['เอกสาร'], 'passage');

  expect(seen[0]).toBe('task: search result | query: ค้นหา');
  expect(seen[1]).toBe('title: none | text: เอกสาร');
});

test('nemotron embed models get query:/passage: prefixes', async () => {
  const { seen, target } = capture();
  const provider = new OllamaEmbeddings({ baseUrl: target, model: 'nemotron-embed:ane-w16' });
  expect(provider.dimensions).toBe(2048);                 // known before the first call

  await provider.embed(['q'], 'query');
  await provider.embed(['d'], 'passage');

  expect(seen).toEqual(['query: q', 'passage: d']);
});
