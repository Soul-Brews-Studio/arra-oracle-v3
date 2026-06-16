import { describe, expect, test } from 'bun:test';
import {
  filterMcpTools,
  McpToolBrowser,
  mcpToolSourceCounts,
  mcpToolSourceLabel,
} from '../../../frontend/src/components/McpToolBrowser';
import type { McpTool } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const tools: McpTool[] = [
  { name: 'echo.say', description: 'Echo a message', group: 'echo', source: 'plugin', plugin: 'echo', readOnly: true },
  { name: 'memory.write', description: 'Store a memory', group: 'memory', source: 'core', readOnly: false },
];

describe('McpToolBrowser source filters', () => {
  test('labels and counts plugin versus core MCP tools', () => {
    expect(mcpToolSourceLabel(tools[0])).toBe('plugin:echo');
    expect(mcpToolSourceLabel(tools[1])).toBe('core');
    expect(mcpToolSourceCounts(tools)).toEqual({ plugin: 1, core: 1 });
  });

  test('filters tools by source and source-aware query text', () => {
    expect(filterMcpTools(tools, '', 'plugin').map((tool) => tool.name)).toEqual(['echo.say']);
    expect(filterMcpTools(tools, 'write', 'all').map((tool) => tool.name)).toEqual(['memory.write']);
    expect(filterMcpTools(tools, 'plugin:echo', 'all').map((tool) => tool.name)).toEqual(['echo.say']);
  });

  test('renders the source selector and source badges from initial tools', () => {
    const html = htmlFor(<McpToolBrowser initialTools={tools} />);
    expect(html).toContain('aria-label="Filter MCP tool source"');
    expect(html).toContain('1 plugin · 1 core');
    expect(html).toContain('plugin:echo');
    expect(html).toContain('core');
  });
});
