import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy maps oracle_search to an API search request', async () => {
  const server = Bun.serve({ port: 0, fetch: (request) => Response.json({ path: new URL(request.url).pathname, query: new URL(request.url).searchParams.get('q') }) });
  try {
    const response = await proxyToolCall(`http://127.0.0.1:${server.port}`, 'oracle_search', { query: 'needle' });
    expect(response?.content[0].text).toContain('"query": "needle"');
  } finally {
    await server.stop();
  }
});
