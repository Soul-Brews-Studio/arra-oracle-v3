import { expect, test } from 'bun:test';
import { closeCachedVectorStores, getVectorStoreByModel, reloadCachedVectorStores } from '../../src/vector/factory.ts';
import type { VectorStoreAdapter } from '../../src/vector/types.ts';

function models(collection: string) {
  return {
    reload_model: {
      collection,
      model: 'reload-model',
      adapter: 'proxy' as const,
      endpoint: 'http://example.invalid',
    },
  };
}

test('reloadCachedVectorStores closes, recreates, and reconnects running adapters', async () => {
  const oldStore = getVectorStoreByModel('reload_model', models('before'), async () => {});
  const connected: string[] = [];

  try {
    const result = await reloadCachedVectorStores(models('after'), async (store: VectorStoreAdapter) => {
      connected.push(store.name);
    });
    const newStore = getVectorStoreByModel('reload_model', models('after'), async () => {});

    expect(result).toEqual({ reloaded: 1 });
    expect(newStore).not.toBe(oldStore);
    expect(connected).toEqual(['proxy']);
  } finally {
    await closeCachedVectorStores();
  }
});
