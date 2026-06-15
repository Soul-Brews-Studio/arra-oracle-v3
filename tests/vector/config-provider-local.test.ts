import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config maps legacy ollama collection provider to local embedder', () => {
  const base = generateDefaultConfig();
  const models = configToModels({
    ...base,
    embedder: undefined,
    collections: { local: { collection: 'local_c', model: 'local-model', provider: 'ollama' } },
  });

  expect(models.local.embedder).toEqual({ backend: 'local', model: 'local-model' });
});
