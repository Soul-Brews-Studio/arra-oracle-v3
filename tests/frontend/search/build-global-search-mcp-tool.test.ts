import { describe, expect, test } from 'bun:test';
import { buildGlobalSearchResults } from '../../../frontend/src/global-search';

describe('buildGlobalSearchResults MCP tool matches', () => {
  test('returns matching MCP tools with encoded detail links', () => {
    const results = buildGlobalSearchResults({
      menu: [],
      plugins: [],
      tools: [{ name: 'plugin:echo', description: 'Echo an Oracle memory', group: 'plugin', source: 'plugin', plugin: 'echo' }],
    }, 'memory');
    expect(results).toMatchObject([{ surface: 'mcp-tool', title: 'plugin:echo', href: '/mcp/tools/plugin%3Aecho' }]);
    expect(results[0].detail).toContain('plugin:echo');
  });
});
