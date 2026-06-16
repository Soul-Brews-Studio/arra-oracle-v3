import { expect, mock, test } from 'bun:test';
import {
  clearProviderDetectionCache,
  getDetectedEmbeddingProviders,
  warmEmbeddingProviderDetection,
} from '../../src/vector/provider-detection.ts';

test('provider detection caches probes until force refresh', async () => {
  clearProviderDetectionCache();
  let n = 0;
  const fetcher = mock(async () => Response.json({ models: [{ name: `model-${++n}` }] })) as unknown as typeof fetch;
  const options = { env: {}, fetcher };

  const first = await getDetectedEmbeddingProviders(false, options);
  const cached = await getDetectedEmbeddingProviders(false, options);
  const forced = await getDetectedEmbeddingProviders(true, options);

  expect(first.providers[0].models).toEqual(['model-1']);
  expect(cached.providers[0].models).toEqual(['model-1']);
  expect(forced.providers[0].models).toEqual(['model-2']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  clearProviderDetectionCache();
});

test('provider detection warmup seeds startup cache', async () => {
  clearProviderDetectionCache();
  let n = 0;
  const fetcher = mock(async () => Response.json({ models: [{ name: `startup-${++n}` }] })) as unknown as typeof fetch;
  const options = { env: {}, fetcher };

  const warmed = await warmEmbeddingProviderDetection(options);
  const cached = await getDetectedEmbeddingProviders(false, options);

  expect(warmed.providers[0].models).toEqual(['startup-1']);
  expect(cached.providers[0].models).toEqual(['startup-1']);
  expect(fetcher).toHaveBeenCalledTimes(1);
  clearProviderDetectionCache();
});

test('provider detection keeps configured Ollama URL visible when probe fails', async () => {
  clearProviderDetectionCache();
  const fetcher = mock(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;

  const result = await getDetectedEmbeddingProviders(true, {
    env: { OLLAMA_BASE_URL: 'http://ollama.internal' },
    fetcher,
  });

  expect(result.providers[0]).toMatchObject({
    type: 'ollama',
    configured: true,
    available: false,
    error: 'HTTP 503',
  });
  clearProviderDetectionCache();
});
