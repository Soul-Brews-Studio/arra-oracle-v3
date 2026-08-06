import { describe, expect, test } from 'bun:test';
import { buildGlobalSearchResults } from '../../../frontend/src/global-search';

describe('buildGlobalSearchResults plugin matches', () => {
  test('matches plugin descriptions and points results at filtered plugin inventory', () => {
    const sources = {
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
    };
    const results = buildGlobalSearchResults(sources, 'workshop');
    expect(results).toMatchObject([{ surface: 'plugin', title: 'echo', href: '/plugins?q=echo' }]);
    expect(results[0].detail).toContain('mcp');
    expect(buildGlobalSearchResults(sources, 'echo.say')).toMatchObject([{ href: '/plugins?q=echo&surface=mcp' }]);
    expect(buildGlobalSearchResults({
      menu: [],
      plugins: [{ name: 'proxybot', file: '', size: 0, modified: 'now', proxy: [{ path: '/proxy/echo', targetEnv: 'ECHO_URL' }] }],
      tools: [],
    }, 'proxy')).toMatchObject([{ href: '/plugins?q=proxybot&surface=proxy' }]);
  });
});
