import { describe, expect, test } from 'bun:test';
import { countPluginSurfaces, surfacesFor } from '../../../frontend/src/plugin-surfaces';

describe('plugin surface library edge cases', () => {
  test('deduplicates inferred surfaces and ignores unknown manifest values', () => {
    const plugin = {
      name: 'echo',
      file: 'echo.wasm',
      size: 1,
      modified: 'now',
      surfaces: ['mcpTools', 'mcp', 'unknown'],
      menu: { label: 'Echo' },
      mcpTools: [{ name: 'echo.say', description: 'Say echo' }],
      apiRoutes: [{ path: '/api/echo' }],
    };

    expect(surfacesFor(plugin)).toEqual(['mcp', 'wasm', 'menu', 'apiRoutes']);
  });

  test('counts metadata-only plugins as one visible surface', () => {
    expect(countPluginSurfaces([
      { name: 'metadata-only', file: '', size: 0, modified: 'now' },
      { name: 'server', file: '', size: 0, modified: 'now', server: { command: 'bun' } },
    ])).toBe(2);
  });
});
