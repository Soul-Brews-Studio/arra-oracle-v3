import { expect, mock, test } from 'bun:test';
import { EmbeddingFallbackChain } from '../../../src/vector/fallback-chain.ts';
import type { EmbeddingProvider, EmbedType } from '../../../src/vector/types.ts';

function provider(
  name: string,
  embed: (texts: string[], type?: EmbedType) => Promise<number[][]>,
): EmbeddingProvider {
  return { name, dimensions: 3, embed: mock(embed) };
}

test('EmbeddingFallbackChain uses the first healthy provider', async () => {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const primary = provider('ollama', async () => [[1, 2, 3]]);
  const fallback = provider('gemini', async () => [[4, 5, 6]]);
  const chain = new EmbeddingFallbackChain([primary, fallback], {
    logger: (message) => logs.push(message),
    sleep: async (ms) => { sleeps.push(ms); },
  });

  await expect(chain.embed(['hello'], 'query')).resolves.toEqual([[1, 2, 3]]);
  expect(primary.embed).toHaveBeenCalledTimes(1);
  expect(fallback.embed).not.toHaveBeenCalled();
  expect(sleeps).toEqual([]);
  expect(logs).toEqual(["[EmbeddingFallbackChain] provider 'ollama' succeeded"]);
  expect(chain.getStats()).toMatchObject({
    attempts: 1,
    failures: 0,
    successes: 1,
    lastProvider: 'ollama',
    providers: {
      ollama: { attempts: 1, failures: 0, successes: 1 },
      gemini: { attempts: 0, failures: 0, successes: 0 },
    },
  });
});

test('EmbeddingFallbackChain falls back in order with exponential backoff', async () => {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const ollama = provider('ollama', async () => { throw new Error('ollama down'); });
  const openai = provider('openai', async () => { throw new Error('openai quota'); });
  const gemini = provider('gemini', async () => [[7, 8, 9]]);
  const chain = new EmbeddingFallbackChain([ollama, openai, gemini], {
    backoffFactor: 3,
    initialBackoffMs: 10,
    logger: (message) => logs.push(message),
    maxBackoffMs: 100,
    sleep: async (ms) => { sleeps.push(ms); },
  });

  await expect(chain.embed(['passage'], 'passage')).resolves.toEqual([[7, 8, 9]]);
  expect(ollama.embed).toHaveBeenCalledTimes(1);
  expect(openai.embed).toHaveBeenCalledTimes(1);
  expect(gemini.embed).toHaveBeenCalledTimes(1);
  expect(sleeps).toEqual([10, 30]);
  expect(logs).toEqual([
    "[EmbeddingFallbackChain] provider 'ollama' failed (ollama down); falling back to 'openai'",
    "[EmbeddingFallbackChain] provider 'openai' failed (openai quota); falling back to 'gemini'",
    "[EmbeddingFallbackChain] provider 'gemini' succeeded",
  ]);
  expect(chain.getStats()).toMatchObject({
    attempts: 1,
    failures: 2,
    successes: 1,
    lastProvider: 'gemini',
    providers: {
      ollama: { attempts: 1, failures: 1, successes: 0, lastError: 'ollama down' },
      openai: { attempts: 1, failures: 1, successes: 0, lastError: 'openai quota' },
      gemini: { attempts: 1, failures: 0, successes: 1 },
    },
  });
});

test('EmbeddingFallbackChain reports failures when no provider succeeds', async () => {
  const sleeps: number[] = [];
  const primary = provider('local', async () => { throw new Error('local missing model'); });
  const remote = provider('remote', async () => { throw new Error('remote timeout'); });
  const chain = new EmbeddingFallbackChain([primary, remote], {
    initialBackoffMs: 5,
    sleep: async (ms) => { sleeps.push(ms); },
    logger: () => undefined,
  });

  await expect(chain.embed(['hello'])).rejects.toThrow('remote timeout');
  expect(sleeps).toEqual([5]);
  expect(chain.getStats()).toMatchObject({
    attempts: 1,
    failures: 2,
    successes: 0,
    providers: {
      local: { attempts: 1, failures: 1, successes: 0, lastError: 'local missing model' },
      remote: { attempts: 1, failures: 1, successes: 0, lastError: 'remote timeout' },
    },
  });
});
