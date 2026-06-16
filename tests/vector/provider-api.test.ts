import { afterEach, expect, mock, test } from 'bun:test';
import {
  clearEmbeddingProviderApiCache,
  createEmbeddingProviderApi,
  detectEmbeddingProviderApi,
} from '../../src/vector/provider-api.ts';
import type { EmbeddingProvider } from '../../src/vector/types.ts';

afterEach(() => clearEmbeddingProviderApiCache());

test('provider API auto-detects local Ollama and remote credentials', async () => {
  const fetcher = mock(async () => Response.json({
    models: [{ name: 'bge-m3' }, { name: 'nomic-embed-text' }],
  })) as unknown as typeof fetch;

  const result = await detectEmbeddingProviderApi({
    force: true,
    fetcher,
    env: {
      OPENAI_API_KEY: 'sk-test',
      GOOGLE_API_KEY: 'gemini-test',
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
    },
  });

  expect(result.providers).toContainEqual(expect.objectContaining({
    type: 'ollama',
    provider: 'ollama',
    status: 'available',
    scope: 'local',
    local: true,
    models: ['bge-m3', 'nomic-embed-text'],
  }));
  expect(result.providers).toContainEqual(expect.objectContaining({
    type: 'openai',
    status: 'available',
    scope: 'remote',
    remote: true,
  }));
  expect(result.providers).toContainEqual(expect.objectContaining({
    type: 'gemini',
    status: 'available',
    models: ['text-embedding-004'],
  }));
  expect(result.providers).toContainEqual(expect.objectContaining({
    type: 'cloudflare-ai',
    scope: 'remote',
    available: true,
  }));
});

test('provider API caches detection until force refresh', async () => {
  let calls = 0;
  const fetcher = mock(async () => Response.json({ models: [{ name: `model-${++calls}` }] })) as unknown as typeof fetch;
  const api = createEmbeddingProviderApi({ env: {}, fetcher });

  const first = await api.detect({ force: true });
  const cached = await api.detect();
  const refreshed = await api.detect({ force: true });

  expect(first.providers[0].models).toEqual(['model-1']);
  expect(cached.providers[0].models).toEqual(['model-1']);
  expect(refreshed.providers[0].models).toEqual(['model-2']);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('provider API probes an embedding provider config', async () => {
  const createProvider = mock((provider): EmbeddingProvider => ({
    name: provider,
    dimensions: 2,
    embed: mock(async () => [[0.1, 0.2, 0.3]]),
  }));
  const api = createEmbeddingProviderApi({ createProvider });

  const result = await api.test({ provider: 'remote', model: 'bge-m3', url: 'http://embed.local' });

  expect(result).toEqual({
    success: true,
    provider: 'remote',
    dimensions: 3,
    model: 'bge-m3',
  });
  expect(createProvider).toHaveBeenCalledWith('remote', 'bge-m3', {
    url: 'http://embed.local',
    dimensions: undefined,
  });
});

test('provider API reports provider probe failures without throwing', async () => {
  const api = createEmbeddingProviderApi({
    createProvider: (provider): EmbeddingProvider => ({
      name: provider,
      dimensions: 0,
      embed: async () => { throw new Error('provider down'); },
    }),
  });

  await expect(api.test({ provider: 'ollama' })).resolves.toEqual({
    success: false,
    provider: 'ollama',
    error: 'provider down',
  });
});
