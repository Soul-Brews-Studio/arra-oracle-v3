import { describe, expect, test } from 'bun:test';
import { globalSearchSurfaceLabel } from '../../../frontend/src/global-search';

describe('globalSearchSurfaceLabel', () => {
  test('maps result surfaces to human-facing labels', () => {
    expect(globalSearchSurfaceLabel('menu')).toBe('Menu');
    expect(globalSearchSurfaceLabel('plugin')).toBe('Plugin');
    expect(globalSearchSurfaceLabel('mcp-tool')).toBe('MCP tool');
  });
});
