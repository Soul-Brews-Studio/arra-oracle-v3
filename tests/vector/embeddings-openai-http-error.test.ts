import { expect, test } from 'bun:test';
import { OpenAIEmbeddings } from '../../src/vector/embeddings.ts';

test('openai embedder surfaces HTTP errors from the provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('openai down', { status: 429 }) as any;
  try {
    const provider = new OpenAIEmbeddings({ apiKey: 'test-key' });

    await expect(provider.embed(['a'])).rejects.toThrow(/OpenAI API error: openai down/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
