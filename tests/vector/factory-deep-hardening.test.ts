import { expect, test } from 'bun:test';
import { createVectorStore, createVectorStoreForModel } from '../../src/vector/factory.ts';
import { trackEnv } from './helpers.ts';

test('vector factory trims adapter type, collection, and proxy endpoint config', () => {
  const store = createVectorStore({
    type: ' proxy ' as never,
    collectionName: ' docs ',
    proxyEndpoint: ' http://vector.local/ ',
  }) as any;

  expect(store.name).toBe('proxy');
  expect(store.collectionName).toBe('docs');
  expect(store.endpoint).toBe('http://vector.local');
});

test('vector factory treats blank ORACLE_VECTOR_DB as unset', () => {
  trackEnv('ORACLE_VECTOR_DB', '   ');
  const store = createVectorStore({ dataPath: '/tmp/arra-vector-factory-hardening' });

  expect(store.name).toBe('lancedb');
});

test('vector factory passes model-level qdrant config when creating stores', () => {
  const store = createVectorStoreForModel({
    collection: 'qdrant_docs',
    model: 'qdrant-model',
    adapter: 'qdrant',
    qdrantUrl: ' http://qdrant.local ',
    qdrantApiKey: ' secret ',
    embedder: { backend: 'none' },
  }) as any;

  expect(store.name).toBe('qdrant');
  expect(store.url).toBe('http://qdrant.local');
  expect(store.apiKey).toBe('secret');
});
