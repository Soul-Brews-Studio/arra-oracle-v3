import { describe, expect, test } from 'bun:test';
import { collectionsFromModels } from '../../../frontend/src/pages/VectorSearchPage';

describe('VectorSearchPage collection options', () => {
  test('normalizes vector index models into collection selector rows', () => {
    const collections = collectionsFromModels({
      models: {
        nomic: { collection: 'oracle_nomic', model: 'nomic-embed-text', adapter: 'lancedb', count: 4 },
      },
    });

    expect(collections).toEqual([{ key: 'nomic', collection: 'oracle_nomic', model: 'nomic-embed-text', adapter: 'lancedb', count: 4 }]);
  });
});
