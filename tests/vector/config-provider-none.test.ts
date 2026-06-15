import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config maps none collection provider to disabled embedder', () => {
  const base = generateDefaultConfig();
  const models = configToModels({
    ...base,
    embedder: undefined,
    collections: { none: { collection: 'none_c', model: 'none-model', provider: 'none' } },
  });

  expect(models.none.embedder).toEqual({ backend: 'none' });
});
