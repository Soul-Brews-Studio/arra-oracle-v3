import { describe, expect, test } from 'bun:test';
import { McpToolBrowser } from '../../../frontend/src/components/McpToolBrowser';
import type { McpTool } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const tool: McpTool = { name: 'echo.say', description: 'Echo input', group: 'echo', source: 'plugin', plugin: 'echo', readOnly: true };

describe('McpToolBrowser a11y edges', () => {
  test('marks loading tool grids busy and labels loading status', () => {
    const html = htmlFor(<McpToolBrowser />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading tools"');
    expect(html).toContain('aria-label="Reload MCP tool list"');
  });

  test('labels schema detail buttons for plugin tools', () => {
    const html = htmlFor(<McpToolBrowser initialTools={[tool]} onOpenTool={() => {}} />);

    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('aria-label="Open schema detail for echo.say"');
    expect(html).toContain('plugin:echo');
    expect(html).toContain('href="/plugins?q=echo&amp;surface=mcp"');
  });
});
