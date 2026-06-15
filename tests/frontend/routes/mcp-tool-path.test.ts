import { describe, expect, test } from 'bun:test';
import { mcpToolPath } from '../../../frontend/src/routePaths';

describe('mcpToolPath', () => {
  test('encodes tool names in the MCP detail route', () => {
    expect(mcpToolPath('plugin:echo')).toBe('/mcp/tools/plugin%3Aecho');
  });
});
