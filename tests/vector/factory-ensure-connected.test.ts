import { expect, test } from 'bun:test';
import { ensureVectorStoreConnected } from '../../src/vector/factory.ts';
import { tempDir } from './helpers.ts';

test('vector store registry waits for a model connection promise when requested', async () => {
  const models = {
    ensure_model: {
      collection: 'ensure_collection',
      model: 'ensure-model',
      adapter: 'lancedb' as const,
      dataPath: tempDir('arra-vector-ensure-'),
      embedder: { backend: 'none' as const },
    },
  };

  const store = await ensureVectorStoreConnected('ensure_model', models);

  expect(store.name).toBe('lancedb');
  await store.close();
});
