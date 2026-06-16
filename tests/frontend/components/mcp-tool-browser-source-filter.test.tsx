import { describe, expect, test } from 'bun:test';
import {
  filterMcpTools,
  McpToolBrowser,
  mcpToolFiltersFromSearch,
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

  test('hydrates source and query filters from shareable route search', () => {
    expect(mcpToolFiltersFromSearch('?q=echo&source=plugin')).toEqual({ query: 'echo', source: 'plugin' });
    expect(mcpToolFiltersFromSearch('?query=memory&source=core')).toEqual({ query: 'memory', source: 'core' });
    expect(mcpToolFiltersFromSearch('?source=bad')).toEqual({ query: '', source: 'all' });

    const html = htmlFor(<McpToolBrowser initialTools={tools} initialSearch="?q=echo&source=plugin" />);
    expect(html).toContain('value="echo"');
    expect(html).toContain('value="plugin" selected');
    expect(html).toContain('1/2 tools');
    expect(html).toContain('echo.say');
    expect(html).toContain('href="/mcp?q=echo&amp;source=plugin"');
  });

  test('renders the source selector and source badges from initial tools', () => {
    const html = htmlFor(<McpToolBrowser initialTools={tools} />);
    expect(html).toContain('aria-label="Filter MCP tool source"');
    expect(html).toContain('1 plugin · 1 core');
    expect(html).toContain('plugin:echo');
    expect(html).toContain('core');
  });
});
