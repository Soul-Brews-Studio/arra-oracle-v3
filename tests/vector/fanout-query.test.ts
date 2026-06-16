import { expect, test } from 'bun:test';
import { mergeFanoutResults, queryFanout } from '../../src/vector/fanout-query.ts';
import type { SearchResult } from '../../src/server/types.ts';

const result = (id: string, score: number, model: string): SearchResult => ({
  id,
  type: 'learning',
  content: id,
  source_file: `${id}.md`,
  concepts: [],
  source: 'vector',
  score,
  model,
});

test('fanout merge deduplicates by id, boosts shared docs, and reranks', () => {
  const merged = mergeFanoutResults([
    result('a', 0.6, 'lancedb'),
    result('b', 0.73, 'lancedb'),
    result('a', 0.7, 'turbovec'),
  ]);

  expect(merged.map((item) => item.id)).toEqual(['a', 'b']);
  expect(merged[0]).toMatchObject({ id: 'a', source: 'hybrid', score: 0.75 });
});

test('fanout query runs targets in parallel and preserves partial errors', async () => {
  const response = await queryFanout({
    text: 'oracle',
    limit: 3,
    targets: [
      { key: 'lancedb', store: { query: async () => ({ ids: ['a'], documents: ['A'], distances: [10], metadatas: [{ type: 'learning' }] }) } },
      { key: 'turbovec', store: { query: async () => { throw new Error('backend down'); } } },
    ],
  });

  expect(response.results).toHaveLength(1);
  expect(response.errors).toEqual({ turbovec: 'backend down' });
});
