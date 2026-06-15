import { expect, test } from 'bun:test';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { allToolGroups, callToolHandler } from './support/server.ts';

test('MCP server call handler resolves legacy tool aliases before dispatch', async () => {
  const api = Bun.serve({ port: 0, fetch: (request) => Response.json({ q: new URL(request.url).searchParams.get('q') }) });
  process.env.ORACLE_HTTP_URL = `http://127.0.0.1:${api.port}`;
  const server = new OracleMCPServer({ toolGroups: allToolGroups });
  try {
    const response = await callToolHandler(server)({ params: { name: 'arra_search', arguments: { query: 'alias-ok' } } });
    expect(response.content[0].text).toContain('alias-ok');
  } finally {
    await server.cleanup();
    await api.stop();
  }
});
