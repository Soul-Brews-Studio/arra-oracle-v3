import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({
    name: 'e2e-vector-search-flow',
    vectorResponder: (url) => ({
      query: url.searchParams.get('q') ?? '',
      total: 1,
      limit: Number(url.searchParams.get('limit') ?? 1),
      offset: 0,
      results: [{
        id: 'vector-flow-doc',
        type: 'learning',
        title: 'Vector flow fixture',
        content: 'Vector search flow returned a deterministic result.',
        source_file: 'ψ/memory/learnings/vector-flow.md',
        source: 'vector',
        score: 0.91,
        project: null,
      }],
    }),
  });
});

afterAll(async () => {
  await server.stop();
});

test('vector search flow sends a query and returns result records', async () => {
  const response = await fetch(`${server.baseUrl}/api/vector/search?q=vector-flow&limit=1`, {
    headers: { accept: 'application/json' },
  });
  expect(response.status).toBe(200);

  const body = await response.json() as {
    query: string;
    total: number;
    limit: number;
    results: Array<Record<string, unknown>>;
  };
  expect(body).toMatchObject({ query: 'vector-flow', total: 1, limit: 1 });
  expect(body.results).toHaveLength(1);
  expect(body.results[0]).toMatchObject({
    id: 'vector-flow-doc',
    type: 'learning',
    source_file: 'ψ/memory/learnings/vector-flow.md',
    source: 'vector',
    score: 0.91,
  });
});
