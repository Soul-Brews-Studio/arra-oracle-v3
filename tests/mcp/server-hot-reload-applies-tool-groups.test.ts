import { expect, test } from 'bun:test';
import { OracleMCPServer } from '../../src/mcp/server.ts';
import { allToolGroups } from './support/server.ts';

test('MCP server hot reload applies watched tool group config updates', async () => {
  process.env.ORACLE_HTTP_URL = 'http://127.0.0.1:1';
  process.env.ORACLE_TOOL_GROUPS_HOT_RELOAD = '1';
  let stopped = false;
  const server = new OracleMCPServer({ watchToolGroups: (onChange) => { onChange({ ...allToolGroups, disabled_tools: ['oracle_search'] }); return () => { stopped = true; }; } });
  await server.cleanup();
  const names = (await (server as any).availableTools()).map((tool: { name: string }) => tool.name);
  expect(names).not.toContain('oracle_search');
  expect(stopped).toBe(true);
});
