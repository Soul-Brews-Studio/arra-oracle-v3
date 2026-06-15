import { describe, expect, test } from 'bun:test';
import { parseRouteHash } from '../../../frontend/src/routePaths';

describe('parseRouteHash tool detail', () => {
  test('decodes MCP tool names from the hash path', () => {
    expect(parseRouteHash('#/mcp-tools/plugin%3Aecho')).toEqual({ kind: 'tool-detail', name: 'plugin:echo' });
  });
});
