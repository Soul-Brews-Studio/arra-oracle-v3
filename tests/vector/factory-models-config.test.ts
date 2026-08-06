import { expect, test } from 'bun:test';
import { getEmbeddingModels } from '../../src/vector/factory.ts';
import { generateDefaultConfig } from '../../src/vector/config.ts';

test('vector store model registry derives presets from vector config when supplied', () => {
  const models = getEmbeddingModels({
    ...generateDefaultConfig(),
    collections: { remote: { collection: 'remote_c', model: 'remote-model', provider: 'remote' } },
  });

  expect(models.remote).toMatchObject({ collection: 'remote_c', model: 'remote-model' });
});
