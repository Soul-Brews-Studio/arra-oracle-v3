import { afterEach, describe, expect, it } from 'bun:test';
import { OllamaEmbeddings } from '../embeddings.ts';

const originalFetch = globalThis.fetch;
const originalAttempts = process.env.ORACLE_EMBED_ATTEMPTS;
const originalDelay = process.env.ORACLE_EMBED_RETRY_DELAY_MS;
const originalBatchSize = process.env.ORACLE_EMBED_BATCH_SIZE;
const originalTimeout = process.env.ORACLE_EMBED_TIMEOUT_MS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAttempts === undefined) delete process.env.ORACLE_EMBED_ATTEMPTS;
  else process.env.ORACLE_EMBED_ATTEMPTS = originalAttempts;
  if (originalDelay === undefined) delete process.env.ORACLE_EMBED_RETRY_DELAY_MS;
  else process.env.ORACLE_EMBED_RETRY_DELAY_MS = originalDelay;
  if (originalBatchSize === undefined) delete process.env.ORACLE_EMBED_BATCH_SIZE;
  else process.env.ORACLE_EMBED_BATCH_SIZE = originalBatchSize;
  if (originalTimeout === undefined) delete process.env.ORACLE_EMBED_TIMEOUT_MS;
  else process.env.ORACLE_EMBED_TIMEOUT_MS = originalTimeout;
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
      return Response.json({ embeddings: [[1, 2, 3, 4]] });
    }) as typeof fetch;

    const embedder = new OllamaEmbeddings({ model: 'bge-m3' });
    const vectors = await embedder.embed(['hello'], 'passage');

    expect(calls).toBe(2);
    expect(vectors).toEqual([[1, 2, 3, 4]]);
    expect(embedder.dimensions).toBe(4);
  });

  it('batches inputs through Ollama /api/embed', async () => {
    process.env.ORACLE_EMBED_BATCH_SIZE = '2';
    const requests: unknown[] = [];
    globalThis.fetch = (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ embeddings: input.map((_, i) => [i, i + 1]) });
    }) as typeof fetch;

    const embedder = new OllamaEmbeddings({ model: 'bge-m3' });
    const vectors = await embedder.embed(['a', 'b', 'c'], 'passage');

    expect(vectors).toEqual([[0, 1], [1, 2], [0, 1]]);
    expect(requests).toEqual([
      { model: 'bge-m3', input: ['passage: a', 'passage: b'] },
      { model: 'bge-m3', input: ['passage: c'] },
    ]);
    expect(embedder.dimensions).toBe(2);
  });

  it('aborts a slow batch with the configured timeout', async () => {
    process.env.ORACLE_EMBED_ATTEMPTS = '1';
    process.env.ORACLE_EMBED_TIMEOUT_MS = '1';
    globalThis.fetch = (async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return Response.json({ embeddings: [[1]] });
    }) as typeof fetch;

    const embedder = new OllamaEmbeddings({ model: 'bge-m3' });
    await expect(embedder.embed(['hello'], 'passage')).rejects.toThrow('failed after 1 attempts: aborted');
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
