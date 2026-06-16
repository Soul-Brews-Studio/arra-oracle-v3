import { expect, mock, test } from 'bun:test';
import { GeminiEmbeddings } from '../../../src/vector/providers/gemini.ts';

test('GeminiEmbeddings posts text to embedContent', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetcher = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ embedding: { values: [0.1, 0.2, 0.3] } });
  }) as unknown as typeof fetch;

  const provider = new GeminiEmbeddings({
    apiKey: 'gemini-key',
    fetcher,
    model: 'models/text-embedding-004',
  });

  await expect(provider.embed(['hello oracle'], 'query')).resolves.toEqual([[0.1, 0.2, 0.3]]);
  expect(provider.dimensions).toBe(768);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(requestUrl).toBe(
    'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent',
  );
  expect(requestInit?.method).toBe('POST');
  expect(new Headers(requestInit?.headers).get('x-goog-api-key')).toBe('gemini-key');
  expect(JSON.parse(String(requestInit?.body))).toEqual({
    content: { parts: [{ text: 'hello oracle' }] },
  });
});

test('GeminiEmbeddings skips empty batches', async () => {
  const fetcher = mock(async () => Response.json({ embedding: { values: [] } })) as unknown as typeof fetch;
  const provider = new GeminiEmbeddings({ apiKey: 'gemini-key', fetcher });

  await expect(provider.embed([])).resolves.toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
