import { expect, test } from 'bun:test';
import { allToolGroups, withProxyServer } from './support/server.ts';

test('MCP server enabled tool whitelist overrides disabled tools', async () => {
  const server = withProxyServer({ toolGroups: { ...allToolGroups, disabled_tools: ['oracle_search'], enabled_tools: ['oracle_search'] } });
  try {
    const names = (await (server as any).availableTools()).map((tool: { name: string }) => tool.name);
    expect(names).toContain('oracle_search');
  } finally {
    await server.cleanup();
  }
});
