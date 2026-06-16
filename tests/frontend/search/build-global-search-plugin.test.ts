import { describe, expect, test } from 'bun:test';
import { buildGlobalSearchResults } from '../../../frontend/src/global-search';

describe('buildGlobalSearchResults plugin matches', () => {
  test('matches plugin descriptions and points results at the plugin page', () => {
    const results = buildGlobalSearchResults({
      menu: [],
      plugins: [{
        name: 'echo',
        file: '',
        size: 0,
        modified: 'now',
        description: 'Workshop assistant',
        mcpTools: [{ name: 'echo.say', description: 'Say echo' }],
      }],
      tools: [],
    }, 'workshop');
    expect(results).toMatchObject([{ surface: 'plugin', title: 'echo', href: '/plugins' }]);
    expect(results[0].detail).toContain('mcp');
  });
});
