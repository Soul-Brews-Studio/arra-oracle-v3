import { describe, expect, test } from 'bun:test';
import { mcpToolsPath, menuCatalogPath, pluginInventoryPath } from '../../../frontend/src/routePaths';

describe('frontend filter route path edge cases', () => {
  test('trims MCP filter values and omits all/blank selectors', () => {
    expect(mcpToolsPath({ q: ' echo ', source: ' plugin ' })).toBe('/mcp?q=echo&source=plugin');
    expect(mcpToolsPath({ q: '   ', source: ' all ' })).toBe('/mcp');
  });

  test('normalizes menu catalog filters before encoding', () => {
    expect(menuCatalogPath({ group: ' tools ', source: ' plugin:echo ' })).toBe('/menu?group=tools&source=plugin%3Aecho');
    expect(menuCatalogPath({ group: ' all ', source: '   ' })).toBe('/menu');
  });

  test('normalizes plugin inventory filters independently', () => {
    expect(pluginInventoryPath({ q: ' echo tools ', surface: ' all ', visibility: ' enabled ' })).toBe('/plugins?q=echo+tools&visibility=enabled');
    expect(pluginInventoryPath({ surface: ' cli ', visibility: ' all ' })).toBe('/plugins?surface=cli');
  });
});
