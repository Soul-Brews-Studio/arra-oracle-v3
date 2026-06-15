import { expect, test } from 'bun:test';
import { getVectorStoreByModel } from '../../src/vector/factory.ts';
import { tempDir } from './helpers.ts';

test('vector store registry logs background connection failures without throwing', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    const store = getVectorStoreByModel('failure_model', {
      failure_model: {
        collection: 'failure_collection',
        model: 'failure-model',
        adapter: 'lancedb',
        dataPath: tempDir('arra-vector-failure-'),
        embedder: { backend: 'none' },
      },
    }, async () => { throw new Error('boom'); });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.name).toBe('lancedb');
    expect(warnings.some((line) => line.includes('Failed to connect failure_model'))).toBe(true);
  } finally {
    console.warn = originalWarn;
  }
});
