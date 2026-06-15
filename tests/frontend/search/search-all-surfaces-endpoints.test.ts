import { describe, expect, test } from 'bun:test';
import { searchAllSurfaces } from '../../../frontend/src/global-search';
import { installFetch, jsonResponse } from '../api/_fetch';

describe('searchAllSurfaces endpoints', () => {
  test('queries menu, plugin, and MCP tool APIs before unifying matches', async () => {
    const fetchMock = installFetch((input) => {
      if (input === '/api/menu') return jsonResponse({ items: [{ label: 'Echo menu', path: '/echo', group: 'tools', order: 1 }] });
      if (input === '/api/v1/plugins') return jsonResponse({ dir: '/plugins', plugins: [{ name: 'echo-plugin', file: '', size: 0, modified: 'now' }] });
      if (input === '/api/mcp/tools') return jsonResponse({ total: 1, tools: [{ name: 'echo.tool', description: 'Echo helper' }] });
      return jsonResponse({}, { status: 404 });
    });
    try {
      const results = await searchAllSurfaces('echo');
      expect(fetchMock.calls.map((call) => call.input)).toEqual(['/api/menu', '/api/v1/plugins', '/api/mcp/tools']);
      expect(results.map((result) => result.surface)).toEqual(['menu', 'plugin', 'mcp-tool']);
    } finally {
      fetchMock.restore();
    }
  });
});
