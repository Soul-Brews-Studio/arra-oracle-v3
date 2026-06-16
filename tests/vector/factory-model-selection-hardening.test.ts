import { expect, test } from 'bun:test';
import { getVectorStoreByModel, getVectorStoreConfigByModel } from '../../src/vector/factory.ts';

test('vector factory falls back to available models and fails clearly when none exist', () => {
  const models = {
    custom: { collection: 'custom_collection', model: 'custom-model', adapter: 'proxy' as const, endpoint: 'http://vector.local' },
  };

  expect(getVectorStoreConfigByModel('missing', models)).toMatchObject({
    type: 'proxy',
    collectionName: 'custom_collection',
    embeddingModel: 'custom-model',
  });
  expect(() => getVectorStoreByModel('missing', {})).toThrow('No embedding models configured');
});
