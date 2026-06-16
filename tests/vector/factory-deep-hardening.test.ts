import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import { trackEnv } from './helpers.ts';

test('vector factory trims adapter type, collection, and proxy endpoint config', () => {
  const store = createVectorStore({
    type: ' proxy ' as never,
    collectionName: ' docs ',
    proxyEndpoint: ' http://vector.local/ ',
  }) as any;

  expect(store.name).toBe('proxy');
  expect(store.collectionName).toBe('docs');
  expect(store.endpoint).toBe('http://vector.local/');
});

test('vector factory treats blank ORACLE_VECTOR_DB as unset', () => {
  trackEnv('ORACLE_VECTOR_DB', '   ');
  const store = createVectorStore({ dataPath: '/tmp/arra-vector-factory-hardening' });

  expect(store.name).toBe('lancedb');
});
