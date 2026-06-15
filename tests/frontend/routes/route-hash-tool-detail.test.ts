import { describe, expect, test } from 'bun:test';
import { routeHash } from '../../../frontend/src/routePaths';

describe('routeHash tool detail', () => {
  test('encodes tool names in the MCP tool hash path', () => {
    expect(routeHash({ kind: 'tool-detail', name: 'plugin:echo' })).toBe('#/mcp-tools/plugin%3Aecho');
  });
});
