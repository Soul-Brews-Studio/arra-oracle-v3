import { describe, expect, test } from 'bun:test';
import { mcpToolsPath } from '../../../frontend/src/routePaths';

describe('mcpToolsPath', () => {
  test('builds shareable MCP tool filter URLs', () => {
    expect(mcpToolsPath()).toBe('/mcp');
    expect(mcpToolsPath({ q: ' echo ', source: 'plugin' })).toBe('/mcp?q=echo&source=plugin');
    expect(mcpToolsPath({ q: '   ', source: 'all' })).toBe('/mcp');
  });
});
