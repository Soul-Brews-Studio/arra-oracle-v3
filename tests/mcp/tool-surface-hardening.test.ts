import { describe, expect, test } from 'bun:test';
import { GUIDE_TOOL_NAME } from '../../src/mcp/guide.ts';
import { mcpToolByName } from '../../src/tools/mcp-manifest.ts';
import { mcpRestMapByName } from '../../src/tools/mcp-rest-map.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';
import { callToolHandler, listToolsHandler, withProxyServer } from './support/server.ts';

describe('stdio MCP tool surface hardening', () => {
  test('lists the important guide first for every client', async () => {
    const server = withProxyServer({ unifiedRuntime: runtimeReturning('ok') });
    try {
      const listed = await listToolsHandler(server)();
      expect(listed.tools[0].name).toBe(GUIDE_TOOL_NAME);
      expect(listed.tools.map((tool: { name: string }) => tool.name)).toContain('oracle_mcp_list_tools');
    } finally {
      await server.cleanup();
    }
  });

  test('dispatches guide locally without an HTTP REST mapping', async () => {
    const server = withProxyServer({ unifiedRuntime: runtimeReturning('ok') });
    try {
      const response = await callToolHandler(server)({ params: { name: GUIDE_TOOL_NAME, arguments: {} } });
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('ORACLE WORKFLOW GUIDE');
      expect(mcpRestMapByName.get(GUIDE_TOOL_NAME)).toMatchObject({ remoteable: false });
    } finally {
      await server.cleanup();
    }
  });

  test('read-only listing keeps safe tools and hides write-capable dispatchers', async () => {
    const server = withProxyServer({ readOnly: true, unifiedRuntime: runtimeReturning('ok') });
    try {
      const names = (await listToolsHandler(server)()).tools.map((tool: { name: string }) => tool.name);
      expect(names).toContain(GUIDE_TOOL_NAME);
      expect(names).toContain('oracle_search');
      expect(names).toContain('oracle_mcp_list_tools');
      expect(names).not.toContain('oracle_learn');
      expect(names).not.toContain('oracle_mcp_call');
    } finally {
      await server.cleanup();
    }
  });

  test('REST map and tool registry agree on local-only bridge boundaries', () => {
    for (const name of [GUIDE_TOOL_NAME, 'oracle_mcp_list_tools', 'oracle_mcp_call']) {
      expect(mcpToolByName.has(name)).toBe(true);
      expect(mcpRestMapByName.get(name)).toMatchObject({ remoteable: false });
    }
  });
});
