import { expect, test } from 'bun:test';
import { selectVectorSearchModelKeys, VECTOR_MULTI_MODEL_ORDER } from '../../src/vector/model-selection.ts';

function modelMap(keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, { collection: key }]));
}

test('multi vector search fans out across bge-m3, nomic, and qwen3 in stable order', () => {
  const keys = selectVectorSearchModelKeys('multi', modelMap(['nomic', 'qwen3', 'bge-m3']));

  expect(keys).toEqual([...VECTOR_MULTI_MODEL_ORDER]);
});

test('multi vector search includes configured extra models after the core trio', () => {
  const keys = selectVectorSearchModelKeys('multi', modelMap(['custom', 'qwen3', 'bge-m3']));

  expect(keys).toEqual(['bge-m3', 'qwen3', 'custom']);
});

test('specific vector search keeps default fallback sentinel for unknown models', () => {
  expect(selectVectorSearchModelKeys('qwen3', modelMap(['bge-m3', 'qwen3']))).toEqual(['qwen3']);
  expect(selectVectorSearchModelKeys('missing', modelMap(['bge-m3', 'qwen3']))).toEqual([undefined]);
  expect(selectVectorSearchModelKeys(undefined, modelMap(['bge-m3']))).toEqual([undefined]);
});
