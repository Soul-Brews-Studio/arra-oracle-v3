import { describe, expect, test } from 'bun:test';
import { pluginInventoryPath } from '../../../frontend/src/routePaths';

describe('pluginInventoryPath', () => {
  test('builds shareable plugin inventory filter URLs', () => {
    expect(pluginInventoryPath()).toBe('/plugins');
    expect(pluginInventoryPath({ q: 'echo tools', surface: 'mcp', visibility: 'enabled' })).toBe('/plugins?q=echo+tools&surface=mcp&visibility=enabled');
    expect(pluginInventoryPath({ surface: 'all', visibility: 'all' })).toBe('/plugins');
  });
});
