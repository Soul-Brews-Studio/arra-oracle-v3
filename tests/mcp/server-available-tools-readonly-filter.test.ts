import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server read-only mode filters write tools', async () => {
  const server = withProxyServer({ readOnly: true });
  try {
    const names = (await (server as any).availableTools()).map((tool: { name: string }) => tool.name);
    expect(names).toContain('oracle_search');
    expect(names).not.toContain('oracle_learn');
  } finally {
    await server.cleanup();
  }
});
