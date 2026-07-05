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

test('fanout merge clamps malformed result scores', () => {
  const merged = mergeFanoutResults([
    result('nan', Number.NaN, 'lancedb'),
    result('negative', -5, 'lancedb'),
    result('huge', 5, 'lancedb'),
    result('nan', 0.2, 'turbovec'),
  ]);

  expect(merged.find((item) => item.id === 'huge')?.score).toBe(1);
  expect(merged.find((item) => item.id === 'negative')?.score).toBe(0);
  expect(merged.find((item) => item.id === 'nan')?.score).toBe(0.25);
  expect(merged.every((item) => Number.isFinite(item.score))).toBe(true);
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


test('fanout query normalizes bad limits and non-finite distances', async () => {
  let seenLimit = 0;
  const response = await queryFanout({
    text: 'oracle',
    limit: Number.NaN,
    targets: [{
      key: 'lancedb',
      store: {
        query: async (_text, limit) => {
          seenLimit = limit ?? 0;
          return {
            ids: ['negative', 'nan'],
            documents: ['negative body', 'nan body'],
            distances: [-10, Number.NaN],
            metadatas: [{}, {}],
          };
        },
      },
    }],
  });

  expect(seenLimit).toBe(10);
  expect(response.results).toHaveLength(2);
  expect(response.results.every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
  expect(response.results.map((item) => item.distance)).toEqual([0, 0]);
});
