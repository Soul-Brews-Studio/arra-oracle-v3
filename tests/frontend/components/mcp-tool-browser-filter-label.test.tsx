import { describe, expect, test } from 'bun:test';
import { McpToolBrowser } from '../../../frontend/src/components/McpToolBrowser';
import { htmlFor } from '../_render';

describe('McpToolBrowser accessibility labels', () => {
  test('labels tool filtering and reload controls', () => {
    const html = htmlFor(<McpToolBrowser />);
    expect(html).toContain('aria-label="Filter MCP tools"');
    expect(html).toContain('aria-label="Reload MCP tool list"');
  });
});
