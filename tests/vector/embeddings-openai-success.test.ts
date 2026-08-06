import { expect, test } from 'bun:test';
import { OpenAIEmbeddings } from '../../src/vector/embeddings.ts';

test('openai embedder sorts returned embeddings by provider index', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [
    { index: 1, embedding: [3, 4] },
    { index: 0, embedding: [1, 2] },
  ] }) as any;
  try {
    const provider = new OpenAIEmbeddings({ apiKey: 'test-key', model: 'text-embedding-3-large' });

    expect(provider.dimensions).toBe(3072);
    expect(await provider.embed(['a', 'b'])).toEqual([[1, 2], [3, 4]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
