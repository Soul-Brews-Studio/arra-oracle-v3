import { describe, expect, it } from 'bun:test';
import { defaultMcpToolOrder, mcpToolByName, mcpTools, toMcpToolDefinition } from '../mcp-manifest.ts';

describe('runtime MCP manifest', () => {
  it('has unique manifest-driven tool names', () => {
    const names = mcpTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('oracle_search');
    expect(names).toContain('oracle_mcp_call');
  });

  it('exposes MCP-out definitions without runtime handlers', () => {
    const tool = mcpToolByName.get('oracle_search');
    expect(tool?.handlerId).toBe('handleSearch');
    expect(typeof tool?.handler).toBe('function');
    expect(toMcpToolDefinition(tool!)).toEqual({
      name: 'oracle_search',
      description: tool!.description,
      inputSchema: tool!.inputSchema,
    });
  });

  it('models read-only behavior from manifest metadata', () => {
    expect(mcpToolByName.get('oracle_search')?.readOnly).toBe(true);
    expect(mcpToolByName.get('oracle_learn')?.readOnly).toBe(false);
    expect(mcpToolByName.get('oracle_mcp_call')?.readOnly).toBe(false);
  });

  it('appends enabled-by-default MCP-IN tools after configured order', () => {
    const order = defaultMcpToolOrder(['____IMPORTANT', 'oracle_search']);
    expect(order[0]).toBe('____IMPORTANT');
    expect(order[1]).toBe('oracle_search');
    expect(order).toContain('oracle_mcp_list_tools');
    expect(order).toContain('oracle_mcp_call');
  });


  it('does not re-enable configured-out static tools', () => {
    const order = defaultMcpToolOrder(['oracle_search']);
    expect(order).toContain('oracle_search');
    expect(order).toContain('oracle_mcp_call');
    expect(order).not.toContain('oracle_learn');
    expect(order).not.toContain('____IMPORTANT');
  });
});
