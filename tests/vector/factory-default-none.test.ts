import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import { clearVectorEnv } from './helpers.ts';

test('vector store factory defaults embedded adapters to the none embedder', () => {
  clearVectorEnv();
  const store = createVectorStore({ type: 'lancedb', dataPath: '/tmp/arra-vector-test' });

  expect((store as any).embedder.name).toBe('none');
});
