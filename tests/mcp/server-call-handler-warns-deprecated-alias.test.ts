import { expect, test, spyOn } from 'bun:test';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { allToolGroups, callToolHandler } from './support/server.ts';

test('MCP server call handler warns once when dispatching a deprecated muninn_ alias', async () => {
  const api = Bun.serve({ port: 0, fetch: (request) => Response.json({ q: new URL(request.url).searchParams.get('q') }) });
  process.env.ORACLE_HTTP_URL = `http://127.0.0.1:${api.port}`;
  const server = new OracleMCPServer({ toolGroups: allToolGroups });
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await callToolHandler(server)({ params: { name: 'muninn_search', arguments: { query: 'alias-ok' } } });
    expect(response.content[0].text).toContain('alias-ok');
    const warnings = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => /muninn_search.*deprecated.*oracle_search/.test(line));
    expect(warnings).toHaveLength(1);
  } finally {
    errorSpy.mockRestore();
    await server.cleanup();
    await api.stop();
  }
});
