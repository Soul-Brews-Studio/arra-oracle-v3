import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';

test('vector store factory uses none embedder for sqlite-vec when no backend is configured', () => {
  const store = createVectorStore({ type: 'sqlite-vec', dataPath: '/tmp/arra-vector.sqlite' });

  expect(store.name).toBe('sqlite-vec');
  expect((store as any).embedder.name).toBe('none');
});
