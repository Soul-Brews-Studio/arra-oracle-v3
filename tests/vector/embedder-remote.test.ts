import { expect, test } from 'bun:test';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { startServer } from './helpers.ts';

test('remote embedder posts text payloads and accepts embeddings arrays', async () => {
  let payload: any = null;
  const target = startServer(async (req) => {
    payload = await req.json();
    return Response.json({ embeddings: [[1, 2], [3, 4]] });
  });
  const provider = createEmbeddingProvider('remote', 'bge-m3', { url: target, dimensions: 2 });

  const vectors = await provider.embed(['alpha', 'beta'], 'query');

  expect(vectors).toEqual([[1, 2], [3, 4]]);
  expect(payload).toMatchObject({ texts: ['alpha', 'beta'], type: 'query', model: 'bge-m3' });
  expect(provider.dimensions).toBe(2);
});
