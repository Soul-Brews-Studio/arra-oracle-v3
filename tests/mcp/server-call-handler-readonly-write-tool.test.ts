import { expect, test } from 'bun:test';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler blocks write tools in read-only mode', async () => {
  const server = withProxyServer({ readOnly: true });
  try {
    const response = await callToolHandler(server)({ params: { name: 'oracle_learn', arguments: {} } });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('disabled in read-only mode');
  } finally {
    await server.cleanup();
  }
});
