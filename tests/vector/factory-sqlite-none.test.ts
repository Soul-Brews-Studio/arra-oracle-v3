import { expect, test } from 'bun:test';
import { createVectorStore } from '../../src/vector/factory.ts';
import { clearVectorEnv, tempDir } from './helpers.ts';

test('vector store factory uses none embedder for sqlite-vec when no backend is configured', () => {
  clearVectorEnv();
  const store = createVectorStore({ type: 'sqlite-vec', dataPath: `${tempDir()}/vectors.sqlite` });

  expect(store.name).toBe('sqlite-vec');
  expect((store as any).embedder.name).toBe('none');
});
