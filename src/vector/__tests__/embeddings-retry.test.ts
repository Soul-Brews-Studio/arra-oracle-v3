import { afterEach, describe, expect, it } from 'bun:test';
import { OllamaEmbeddings } from '../embeddings.ts';

const originalFetch = globalThis.fetch;
const originalAttempts = process.env.ORACLE_EMBED_ATTEMPTS;
const originalDelay = process.env.ORACLE_EMBED_RETRY_DELAY_MS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAttempts === undefined) delete process.env.ORACLE_EMBED_ATTEMPTS;
  else process.env.ORACLE_EMBED_ATTEMPTS = originalAttempts;
  if (originalDelay === undefined) delete process.env.ORACLE_EMBED_RETRY_DELAY_MS;
  else process.env.ORACLE_EMBED_RETRY_DELAY_MS = originalDelay;
});

describe('OllamaEmbeddings retry diagnostics (#987)', () => {
  it('retries transient embed failures before succeeding', async () => {
    process.env.ORACLE_EMBED_ATTEMPTS = '2';
    process.env.ORACLE_EMBED_RETRY_DELAY_MS = '1';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response('temporary ollama failure', { status: 500 });
      }
      return Response.json({ embedding: [1, 2, 3, 4] });
    }) as typeof fetch;

    const embedder = new OllamaEmbeddings({ model: 'bge-m3' });
    const vectors = await embedder.embed(['hello'], 'passage');

    expect(calls).toBe(2);
    expect(vectors).toEqual([[1, 2, 3, 4]]);
    expect(embedder.dimensions).toBe(4);
  });

  it('throws attempt count and original message after retries are exhausted', async () => {
    process.env.ORACLE_EMBED_ATTEMPTS = '2';
    process.env.ORACLE_EMBED_RETRY_DELAY_MS = '1';
    globalThis.fetch = (async () => {
      throw new Error('socket reset');
    }) as typeof fetch;

    const embedder = new OllamaEmbeddings({ model: 'bge-m3' });

    await expect(embedder.embed(['hello'], 'passage')).rejects.toThrow('failed after 2 attempts: socket reset');
  });
});
