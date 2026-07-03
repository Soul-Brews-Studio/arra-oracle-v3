import { describe, expect, test } from 'bun:test';
import { runHonestRecallBenchmark, type Searcher } from '../../benchmarks/honest-recall.ts';

describe('honest recall retrieve depth', () => {
  test('requests a deeper configured candidate pool before truncating to Recall@k', async () => {
    const requested: number[] = [];
    const searcher: Searcher = async ({ topK }) => {
      requested.push(topK);
      return Array.from({ length: topK }, (_, index) => ({ id: index === 9 ? 'doc-a' : `noise-${index}` }));
    };

    const report = await runHonestRecallBenchmark({
      cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-a'] }],
      corpus: { label: 'oracle-test', size: 30 },
      topK: 3,
      retrieveDepth: 10,
      searcher,
      gitSha: 'abc123',
    });

    expect(requested).toEqual([10]);
    expect(report.cases[0].retrieved_ids).toHaveLength(3);
    expect(report.metrics[0]).toMatchObject({ value: 0, top_k: 3 });
  });
});
