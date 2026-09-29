import { expect, test } from 'bun:test';

test('routes that close vector stores use owned, not cached, connections', async () => {
  for (const path of ['src/routes/vector/search.ts', 'src/routes/vector/export.ts']) {
    const source = await Bun.file(path).text();
    expect(source).not.toContain('getVectorStoreByModel');
    expect(source).toContain('createVectorStore(getVectorStoreConfigByModel(model))');
  }
});
