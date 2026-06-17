import { describe, expect, test } from 'bun:test';
import { buildGlobalSearchResults } from '../../../frontend/src/global-search';

describe('buildGlobalSearchResults menu matches', () => {
  test('returns matching menu rows as navigable unified results', () => {
    const results = buildGlobalSearchResults({
      menu: [{ label: 'Vector search', path: '/vector', group: 'tools', order: 3, source: 'plugin', sourceName: 'vector' }],
      plugins: [],
      tools: [],
    }, 'vector');
    expect(results).toMatchObject([{ surface: 'menu', title: 'Vector search', href: '/vector' }]);
    expect(results[0].detail).toBe('/vector · tools · plugin:vector');
  });
});
