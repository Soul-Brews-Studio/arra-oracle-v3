import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';
import { canvasAppPath, canvasStandaloneUrl, pluginInventoryPath, vectorResultsPath } from '../../../frontend/src/routePaths';

describe('frontend route utility edge cases', () => {
  test('keeps malformed MCP tool URL labels stable instead of throwing', () => {
    const meta = routeMeta('/mcp/tools/%E0%A4%A');
    expect(meta.description).toContain('%E0%A4%A');
    expect(meta.breadcrumbs.at(-1)).toEqual({ label: '%E0%A4%A' });
  });

  test('omits empty vector result query labels in route metadata', () => {
    const meta = routeMeta('/vector/results', '?q=%20%20');
    expect(meta.description).toBe('Full-page vector search results.');
    expect(meta.breadcrumbs.at(-1)).toEqual({ label: 'Results' });
    expect(vectorResultsPath('  ')).toBe('/vector/results');
  });

  test('encodes shareable route helper queries without all-filter noise', () => {
    expect(canvasAppPath(' wave field ')).toBe('/canvas?plugin=wave+field');
    expect(canvasStandaloneUrl('wave', 'https://canvas.example.test/base/')).toBe('https://canvas.example.test/?plugin=wave');
    expect(pluginInventoryPath({ q: ' api tools ', surface: 'apiRoutes', visibility: 'all' })).toBe('/plugins?q=api+tools&surface=apiRoutes');
  });
});
