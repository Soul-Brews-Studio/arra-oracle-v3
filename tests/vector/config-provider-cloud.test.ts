import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config maps cloud collection providers to embedder backends', () => {
  const base = generateDefaultConfig();
  const models = configToModels({
    ...base,
    embedder: undefined,
    collections: { gemini: { collection: 'gemini_c', model: 'text-embedding-004', provider: 'gemini' } },
  });

  expect(models.gemini.embedder).toEqual({ backend: 'gemini', model: 'text-embedding-004' });
});
