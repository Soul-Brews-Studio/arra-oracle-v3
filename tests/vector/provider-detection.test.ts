import { expect, mock, test } from 'bun:test';
import { clearProviderDetectionCache, getDetectedEmbeddingProviders } from '../../src/vector/provider-detection.ts';

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
