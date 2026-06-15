import { afterAll, beforeAll, expect, test } from 'bun:test';
import { logSmoke, startSmokeServer, type SmokeServer } from './_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({
    name: 'vector-search',
    vectorResponder: (url) => ({
      results: [{
        id: 'vector-smoke-doc',
        type: 'learning',
        content: `remote vector hit for ${url.searchParams.get('q')}`,
        source_file: 'vector/smoke.md',
        concepts: ['smoke'],
        source: 'vector',
        score: 0.91,
        project: null,
      }],
      total: 1,
      limit: Number(url.searchParams.get('limit') ?? 1),
      offset: 0,
      query: url.searchParams.get('q') ?? '',
    }),
  });
});

afterAll(async () => {
  await server.stop();
});

test('live search route returns a result from the vector proxy leg', async () => {
  const url = new URL('/api/search', server.baseUrl);
  url.searchParams.set('q', 'remote vector smoke');
  url.searchParams.set('mode', 'hybrid');
  url.searchParams.set('limit', '1');
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = await res.json() as { results: Array<{ id: string; source: string }>; total: number };
  expect(body.total).toBe(1);
  expect(body.results[0]).toMatchObject({ id: 'vector-smoke-doc', source: 'vector' });
  logSmoke('vector-search-query', { result: body.results[0]?.id, total: body.total });
});
