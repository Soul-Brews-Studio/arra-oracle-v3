import { expect, mock, test } from 'bun:test';
import { RemoteHttpEmbeddings, parseRemoteEmbeddingResponse } from '../../src/vector/embedding-backends.ts';
import { trackEnv } from './helpers.ts';

test('remote embedder parser rejects malformed and non-finite vectors', () => {
  expect(() => parseRemoteEmbeddingResponse(null, 1)).toThrow('missing embeddings array');
  expect(() => parseRemoteEmbeddingResponse({ embeddings: [[]] }, 1)).toThrow('non-empty number[]');
  expect(() => parseRemoteEmbeddingResponse({ embeddings: [[Number.NaN]] }, 1)).toThrow('finite numbers');
  expect(() => parseRemoteEmbeddingResponse({ embeddings: [[Infinity]] }, 1)).toThrow('finite numbers');
});

test('remote embedder ignores invalid dimension env and short-circuits empty input', async () => {
  trackEnv('ORACLE_EMBEDDING_DIMENSIONS', 'not-a-number');
  trackEnv('ORACLE_EMBEDDER_URL', 'http://127.0.0.1:9/embed');
  const provider = new RemoteHttpEmbeddings();
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () => Response.json({ embeddings: [] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  try {
    expect(provider.dimensions).toBe(768);
    expect(await provider.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
