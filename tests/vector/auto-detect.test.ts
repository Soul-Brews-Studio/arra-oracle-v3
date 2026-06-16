import { afterEach, expect, mock, test } from 'bun:test';
import {
  clearEmbeddingProviderAutoDetectCache,
  detectEmbeddingProviders,
} from '../../src/vector/auto-detect.ts';

afterEach(() => {
  clearEmbeddingProviderAutoDetectCache();
});

test('detects Ollama models and configured remote embedding providers', async () => {
  const fetcher = mock(async (input: string | URL | Request) => {
    expect(String(input)).toBe('http://localhost:11434/api/tags');
    return Response.json({
      models: [{ name: 'bge-m3' }, { name: 'nomic-embed-text' }],
    });
  }) as unknown as typeof fetch;

  const providers = await detectEmbeddingProviders({
    env: {
      OPENAI_API_KEY: 'sk-test',
      GEMINI_API_KEY: 'gemini-test',
      CF_ACCOUNT_ID: 'cf-account',
      CF_API_TOKEN: 'cf-token',
    },
    fetcher,
  });

  expect(providers).toEqual([
    {
      provider: 'ollama',
      status: 'available',
      models: ['bge-m3', 'nomic-embed-text'],
    },
    {
      provider: 'openai',
      status: 'available',
      models: ['text-embedding-3-small', 'text-embedding-3-large'],
    },
    {
      provider: 'gemini',
      status: 'available',
      models: ['text-embedding-004'],
    },
    {
      provider: 'cloudflare-ai',
      status: 'available',
      models: ['@cf/baai/bge-m3'],
    },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('marks providers unavailable when probes and env credentials are missing', async () => {
  const fetcher = mock(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;

  const providers = await detectEmbeddingProviders({ env: {}, fetcher });

  expect(providers).toEqual([
    { provider: 'ollama', status: 'unavailable' },
    { provider: 'openai', status: 'unavailable' },
    { provider: 'gemini', status: 'unavailable' },
    { provider: 'cloudflare-ai', status: 'unavailable' },
  ]);
});

test('caches detection results until forced', async () => {
  let calls = 0;
  const fetcher = mock(async () => Response.json({
    models: [{ name: `model-${++calls}` }],
  })) as unknown as typeof fetch;

  const first = await detectEmbeddingProviders({ env: {}, fetcher });
  const cached = await detectEmbeddingProviders({
    env: { OPENAI_API_KEY: 'new-key' },
    fetcher,
  });
  const refreshed = await detectEmbeddingProviders({
    env: { OPENAI_API_KEY: 'new-key' },
    fetcher,
    force: true,
  });

  expect(first[0]).toEqual({ provider: 'ollama', status: 'available', models: ['model-1'] });
  expect(cached[0]).toEqual(first[0]);
  expect(cached[1]).toEqual({ provider: 'openai', status: 'unavailable' });
  expect(refreshed[0]).toEqual({ provider: 'ollama', status: 'available', models: ['model-2'] });
  expect(refreshed[1]).toEqual({
    provider: 'openai',
    status: 'available',
    models: ['text-embedding-3-small', 'text-embedding-3-large'],
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
