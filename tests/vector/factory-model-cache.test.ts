import { expect, test } from 'bun:test';
import { ensureVectorStoreConnected, getVectorStoreByModel } from '../../src/vector/factory.ts';
import { tempDir } from './helpers.ts';

test('vector store registry caches model stores by resolved model key', async () => {
  const models = {
    cache_model: {
      collection: 'cache_collection',
      model: 'cache-model',
      adapter: 'lancedb' as const,
      dataPath: tempDir('arra-vector-cache-'),
      embedder: { backend: 'none' as const },
    },
  };

  const first = getVectorStoreByModel('cache_model', models);
  const second = getVectorStoreByModel('cache_model', models);

  expect(first.name).toBe('lancedb');
  expect(second).toBe(first);
  await ensureVectorStoreConnected('cache_model', models);
  await first.close();
});
