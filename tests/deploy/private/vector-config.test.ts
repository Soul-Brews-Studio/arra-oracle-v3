import { expect, test } from 'bun:test';
import { configToModels, loadVectorConfig } from '../../../src/vector/config.ts';

test('private vector template isolates CPU BGE vectors in a 1024-dimensional sqlite-vec collection', () => {
  const config = loadVectorConfig('deploy/private/arra-full-stack/vector-server.private.json');
  expect(config).not.toBeNull();
  const models = configToModels(config!);
  expect(Object.keys(models)).toEqual(['bge-m3']);
  expect(models['bge-m3']).toMatchObject({
    collection: 'oracle_knowledge_bge_m3',
    adapter: 'sqlite-vec',
    provider: 'ollama',
    model: 'bge-m3',
    embedder: { backend: 'ollama', model: 'bge-m3', dimensions: 1024 },
  });
});
