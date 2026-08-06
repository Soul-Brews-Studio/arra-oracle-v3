import { expect, mock, test } from 'bun:test';
import { EmbeddingFallbackChain, type FallbackChainEvent } from '../../../src/vector/fallback-chain.ts';
import type { EmbeddingProvider } from '../../../src/vector/types.ts';

function provider(name: string, embed: EmbeddingProvider['embed']): EmbeddingProvider {
  return { name, dimensions: 3, embed };
}

test('EmbeddingFallbackChain logs fallback and resumes on the working provider', async () => {
  const events: FallbackChainEvent[] = [];
  const logs: string[] = [];
  const ollama = provider('ollama', mock(async () => { throw new Error('ollama down'); }));
  const gemini = provider('gemini', mock(async () => [[1, 2, 3]]));
  const openai = provider('openai', mock(async () => [[9, 9, 9]]));

  const chain = new EmbeddingFallbackChain([ollama, gemini, openai], {
    logger: (message) => logs.push(message),
    onFallback: (event) => events.push(event),
    sleep: async () => undefined,
  });

  await expect(chain.embed(['doc 1'], 'passage')).resolves.toEqual([[1, 2, 3]]);
  await expect(chain.embed(['doc 2'], 'passage')).resolves.toEqual([[1, 2, 3]]);

  expect(ollama.embed).toHaveBeenCalledTimes(1);
  expect(gemini.embed).toHaveBeenCalledTimes(2);
  expect(openai.embed).not.toHaveBeenCalled();
  expect(events).toEqual([{ from: 'ollama', to: 'gemini', error: 'ollama down' }]);
  expect(logs.some((message) => message.includes("falling back to 'gemini'"))).toBe(true);
  expect(chain.getStats()).toMatchObject({ activeProvider: 'gemini', lastProvider: 'gemini' });
});
