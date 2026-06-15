import { expect, test } from 'bun:test';
import { allToolGroups, callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler blocks disabled tools', async () => {
  const server = withProxyServer({ toolGroups: { ...allToolGroups, disabled_tools: ['oracle_search'] } });
  try {
    const response = await callToolHandler(server)({ params: { name: 'oracle_search', arguments: {} } });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('disabled by tool group config');
  } finally {
    await server.cleanup();
  }
});
