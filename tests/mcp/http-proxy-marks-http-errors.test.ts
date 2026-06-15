import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy marks non-ok API responses as tool errors', async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('bad', { status: 500 }) });
  try {
    const response = await proxyToolCall(`http://127.0.0.1:${server.port}`, 'oracle_stats', {});
    expect(response).toEqual({ content: [{ type: 'text', text: 'bad' }], isError: true });
  } finally {
    await server.stop();
  }
});
