import { describe, expect, test } from 'bun:test';
import { buildRetrievalMetrics } from '../../benchmarks/honest-recall-methodology.ts';

describe('honest recall metric methodology', () => {
  test('separates answerable recall from negative-control rejects', () => {
    const metrics = buildRetrievalMetrics([
      { expected_ids: ['doc-a'], retrieved_ids: ['doc-a'], hit: true },
      { expected_ids: ['doc-b'], retrieved_ids: ['noise'], hit: false },
      { expected_ids: [], retrieved_ids: [], hit: true },
    ], 3, 'Recall@3');

    expect(metrics.find((row) => row.metric === 'Answerable-Recall@k')).toMatchObject({ value: 0.5, hits: 1, total_queries: 2 });
    expect(metrics.find((row) => row.metric === 'Reject-Recall')).toMatchObject({ value: 1, hits: 1, total_queries: 1 });
    expect(metrics.find((row) => row.metric === 'Reject-Precision')).toMatchObject({ value: 1, hits: 1, total_queries: 1, predicted_rejects: 1 });
  });

  test('publishes variance from repeated deterministic runs', () => {
    const metrics = buildRetrievalMetrics([], 3, 'Recall@3', {
      'Answerable-Recall@k': [0.9, 1, 0.8],
      'Reject-Recall': [1, 1, 1],
    });

    expect(metrics.find((row) => row.metric === 'Answerable-Recall@k')).toMatchObject({
      value: 0.9,
      runs: 3,
      variance: 0.006667,
      stdev: 0.08165,
    });
    expect(metrics.find((row) => row.metric === 'Reject-Recall')).toMatchObject({
      value: 1,
      runs: 3,
      variance: 0,
      stdev: 0,
    });
  });
});
