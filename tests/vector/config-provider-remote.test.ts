import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config maps remote collection provider to remote embedder', () => {
  const base = generateDefaultConfig();
  const models = configToModels({
    ...base,
    embedder: undefined,
    collections: { remote: { collection: 'remote_c', model: 'remote-model', provider: 'remote' } },
  });

  expect(models.remote.embedder).toEqual({ backend: 'remote', model: 'remote-model' });
});
