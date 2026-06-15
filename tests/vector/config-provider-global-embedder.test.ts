import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config global embedder applies to every collection with collection model fallback', () => {
  const models = configToModels({ ...generateDefaultConfig(), embedder: { backend: 'remote', url: 'http://embed' } });

  expect(models['bge-m3'].embedder).toEqual({ backend: 'remote', url: 'http://embed', model: 'bge-m3' });
});
