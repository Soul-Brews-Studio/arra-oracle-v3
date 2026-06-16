import { expect, mock, test } from 'bun:test';
import { FallbackEmbeddings } from '../../src/vector/embeddings.ts';
import type { EmbeddingProvider } from '../../src/vector/types.ts';

function provider(name: string, result: number[][] | Error): EmbeddingProvider {
  return {
    name,
    dimensions: 2,
    embed: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

test('fallback embedder tries the next provider and logs the fallback event', async () => {
  const events: Array<{ from: string; to?: string; error: string }> = [];
  const embedder = new FallbackEmbeddings([
    provider('ollama', new Error('ollama down')),
    provider('openai', [[1, 2]]),
  ], (event) => events.push(event));

  expect(await embedder.embed(['hello'], 'passage')).toEqual([[1, 2]]);
  expect(events).toEqual([{ from: 'ollama', to: 'openai', error: 'ollama down' }]);
});

test('fallback embedder resumes from the healthy provider after failover', async () => {
  const ollama = { name: 'ollama', dimensions: 2, embed: mock(async () => { throw new Error('ollama down'); }) };
  const gemini = { name: 'gemini', dimensions: 2, embed: mock(async () => [[3, 4]]) };
  const embedder = new FallbackEmbeddings([ollama, gemini], () => undefined);

  expect(await embedder.embed(['first'], 'passage')).toEqual([[3, 4]]);
  expect(await embedder.embed(['second'], 'passage')).toEqual([[3, 4]]);
  expect(ollama.embed).toHaveBeenCalledTimes(1);
  expect(gemini.embed).toHaveBeenCalledTimes(2);
});
