import { expect, test, spyOn } from 'bun:test';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { allToolGroups, callToolHandler } from './support/server.ts';

/**
 * `muninn_` completed its deprecation cycle (#2824) and no longer dispatches.
 *
 * The point of this test is the SECOND assertion. #2824 held the removal back for a release
 * specifically because `resolveToolName` fails silently — an unmatched prefix is returned
 * unchanged and dies later as a generic tool-not-found, "a confusing error with no hint about
 * the rename" (ui-oracle). Logging to stderr is not enough: an MCP client sees the response,
 * not the server's stderr. So the error text itself carries the replacement.
 */
test('MCP server refuses a retired muninn_ alias and names the replacement in the RESPONSE', async () => {
  const api = Bun.serve({ port: 0, fetch: (request) => Response.json({ q: new URL(request.url).searchParams.get('q') }) });
  process.env.ORACLE_HTTP_URL = `http://127.0.0.1:${api.port}`;
  const server = new OracleMCPServer({ toolGroups: allToolGroups });
  const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await callToolHandler(server)({ params: { name: 'muninn_search', arguments: { query: 'alias-ok' } } });
    const text = String(response.content[0].text);

    expect(text).toContain('Unknown tool');
    // The part a client can act on, without reading the server's logs.
    expect(text).toContain('was REMOVED');
    expect(text).toContain('oracle_search');

    const notices = errorSpy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('was REMOVED'));
    expect(notices).toHaveLength(1);
  } finally {
    errorSpy.mockRestore();
    await server.cleanup();
    await api.stop();
  }
});

test('a canonical oracle_* call still dispatches normally', async () => {
  const api = Bun.serve({ port: 0, fetch: (request) => Response.json({ q: new URL(request.url).searchParams.get('q') }) });
  process.env.ORACLE_HTTP_URL = `http://127.0.0.1:${api.port}`;
  const server = new OracleMCPServer({ toolGroups: allToolGroups });
  try {
    const response = await callToolHandler(server)({ params: { name: 'oracle_search', arguments: { query: 'alias-ok' } } });
    expect(String(response.content[0].text)).toContain('alias-ok');
  } finally {
    await server.cleanup();
    await api.stop();
  }
});
