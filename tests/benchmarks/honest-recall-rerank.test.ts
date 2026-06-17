import { describe, expect, test } from 'bun:test';
import { runHonestRecallBenchmark, type Searcher } from '../../benchmarks/honest-recall.ts';

describe('honest recall benchmark rerank stage', () => {
  test('is off by default and keeps the requested retrieval depth', async () => {
    const seen: number[] = [];
    const searcher: Searcher = async ({ topK }) => {
      seen.push(topK);
      return [{ id: 'doc-a' }, { id: 'doc-b' }];
    };

    const report = await runHonestRecallBenchmark({
      cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-a'] }],
      corpus: { label: 'tiny', size: 12 },
      topK: 3,
      searcher,
      gitSha: 'abc123',
      now: '2026-06-17T00:00:00.000Z',
    });

    expect(seen).toEqual([3]);
    expect(report.provenance.rerank).toBeUndefined();
    expect(report.cases[0].retrieved_ids).toEqual(['doc-a', 'doc-b']);
  });

  test('fetches 100 hybrid/RRF candidates and reranks them to the final topK', async () => {
    const sidecar = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const body = await request.json() as { candidates: string[]; top_k: number };
        expect(new URL(request.url).pathname).toBe('/rerank');
        expect(body.candidates).toHaveLength(4);
        expect(body.top_k).toBe(3);
        return Response.json({
          model: 'BAAI/bge-reranker-v2-m3',
          results: [2, 0, 1].map((index) => ({ index, score: 1 - index / 10, document: body.candidates[index] })),
        });
      },
    });
    const seen: number[] = [];
    const searcher: Searcher = async ({ topK }) => {
      seen.push(topK);
      return [
        { id: 'doc-a', content: 'alpha first' },
        { id: 'doc-b', content: 'beta second' },
        { id: 'doc-c', content: 'best answer' },
        { id: 'doc-d', content: 'extra candidate' },
      ];
    };

    try {
      const report = await runHonestRecallBenchmark({
        cases: [{ id: 'q1', query: 'alpha', expectedIds: ['doc-c'] }],
        corpus: { label: 'tiny', size: 12 },
        topK: 3,
        searcher,
        rerank: { enabled: true, url: `http://127.0.0.1:${sidecar.port}` },
        gitSha: 'abc123',
        now: '2026-06-17T00:00:00.000Z',
      });

      expect(seen).toEqual([100]);
      expect(report.provenance.rerank).toMatchObject({ enabled: true, model: 'bge-reranker-v2-m3', retrieve_k: 100, applied: true });
      expect(report.provenance.stack).toContain('bge-reranker-v2-m3');
      expect(report.cases[0]).toMatchObject({ retrieved_ids: ['doc-c', 'doc-a', 'doc-b'], hit: true, matched_rank: 1 });
    } finally {
      await sidecar.stop(true);
    }
  });
});
