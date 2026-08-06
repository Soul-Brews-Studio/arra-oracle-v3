import { afterAll, expect, test } from 'bun:test';
import { createVectorProxy } from '../vector-proxy.ts';

const requests: string[] = [];
const remote = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    requests.push(`${url.pathname}${url.search}`);
    return Response.json({ query: url.searchParams.get('q'), total: 0, results: [] });
  },
});

afterAll(() => remote.stop(true));

test('vector proxy ignores blank URLs', () => {
  expect(createVectorProxy('   ')).toBeNull();
});

test('vector proxy trims base URL and preserves falsy numeric query params', async () => {
  const proxy = createVectorProxy(`  http://127.0.0.1:${remote.port}/  `);
  const result = await proxy?.search({ q: 'a b&c', limit: 0, offset: 0 });

  expect(result).toMatchObject({ query: 'a b&c', total: 0, results: [] });
  expect(requests).toContain('/api/search?q=a%20b%26c&limit=0&offset=0');
});
