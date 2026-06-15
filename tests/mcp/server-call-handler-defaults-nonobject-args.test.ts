import { expect, test } from 'bun:test';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server call handler treats non-object arguments as empty input', async () => {
  const server = withProxyServer();
  try {
    const response = await callToolHandler(server)({ params: { name: '____IMPORTANT' } });
    expect(response.content[0].text).toContain('ORACLE WORKFLOW GUIDE');
  } finally {
    await server.cleanup();
  }
});
