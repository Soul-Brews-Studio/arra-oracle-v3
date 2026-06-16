import { afterEach, expect, mock, test } from 'bun:test';
import { GeminiEmbeddings } from '../../src/vector/embeddings.ts';

const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

test('GeminiEmbeddings calls embedContent and returns vectors in input order', async () => {
  process.env.GEMINI_API_KEY = 'gemini-key';
  const calls: Array<{ url: string; init?: RequestInit; body: any }> = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init?.body)) });
    return Response.json({ embedding: { values: [calls.length, 0.5] } });
  }) as unknown as typeof fetch;

  const vectors = await new GeminiEmbeddings().embed(['first', 'second'], 'query');

  expect(vectors).toEqual([[1, 0.5], [2, 0.5]]);
  expect(calls.every((call) => call.url.endsWith('/models/text-embedding-004:embedContent'))).toBe(true);
  expect(calls.every((call) => new Headers(call.init?.headers).get('x-goog-api-key') === 'gemini-key')).toBe(true);
  expect(calls.map((call) => call.body.content.parts[0].text)).toEqual(['first', 'second']);
});

test('GeminiEmbeddings rejects malformed embedding payloads', async () => {
  globalThis.fetch = mock(async () => Response.json({ embedding: {} })) as unknown as typeof fetch;

  await expect(new GeminiEmbeddings({ apiKey: 'k' }).embed(['hello'])).rejects.toThrow('invalid embedding payload');
});
