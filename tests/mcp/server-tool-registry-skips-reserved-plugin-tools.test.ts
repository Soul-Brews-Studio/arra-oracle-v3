import { expect, test } from 'bun:test';
import { runtimeReturning } from './support/plugin-runtime.ts';
import { withProxyServer } from './support/server.ts';

test('MCP server registry keeps built-in tools ahead of reserved plugin names', async () => {
  const server = withProxyServer({ unifiedRuntime: runtimeReturning('ok', { name: 'oracle_search' }) });
  try {
    const registry = await (server as any).toolRegistry();
    expect(registry.get('oracle_search').handlerId).toBe('handleSearch');
  } finally {
    await server.cleanup();
  }
});
