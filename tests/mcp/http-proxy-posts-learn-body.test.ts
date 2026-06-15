import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy sends JSON bodies for write tools', async () => {
  const server = Bun.serve({ port: 0, fetch: async (request) => Response.json({ method: request.method, body: await request.json() }) });
  try {
    const response = await proxyToolCall(`http://127.0.0.1:${server.port}`, 'oracle_learn', { pattern: 'x' });
    expect(response?.content[0].text).toContain('"pattern": "x"');
  } finally {
    await server.stop();
  }
});
