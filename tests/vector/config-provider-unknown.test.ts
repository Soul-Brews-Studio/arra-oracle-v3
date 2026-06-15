import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config leaves unknown collection providers unchanged for legacy handling', () => {
  const base = generateDefaultConfig();
  const models = configToModels({
    ...base,
    embedder: undefined,
    collections: { unknown: { collection: 'unknown_c', model: 'unknown-model', provider: 'other' } },
  });

  expect(models.unknown.embedder).toBeUndefined();
});
