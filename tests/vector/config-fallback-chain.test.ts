import { expect, test } from 'bun:test';
import { configToModels, generateDefaultConfig } from '../../src/vector/config.ts';

test('vector config propagates embedder fallback chain to model presets', () => {
  const models = configToModels({
    ...generateDefaultConfig(),
    embedder: { backend: 'ollama', fallbackChain: ['gemini', 'openai'] },
  });

  expect(models['bge-m3'].embedder).toMatchObject({
    backend: 'ollama',
    model: 'bge-m3',
    fallbackChain: ['gemini', 'openai'],
  });
});
