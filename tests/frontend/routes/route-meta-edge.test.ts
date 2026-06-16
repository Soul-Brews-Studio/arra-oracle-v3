import { describe, expect, test } from 'bun:test';
import { routeMeta } from '../../../frontend/src/routeMeta';

describe('routeMeta routing edge cases', () => {
  test('decodes encoded MCP tool names for breadcrumbs and descriptions', () => {
    const meta = routeMeta('/mcp/tools/plugin%3Aecho%2Finspect');

    expect(meta.description).toBe('Inspect schema and metadata for plugin:echo/inspect.');
    expect(meta.breadcrumbs.at(-1)).toEqual({ label: 'plugin:echo/inspect' });
  });

  test('keeps malformed encoded MCP route labels without throwing', () => {
    const meta = routeMeta('/mcp/tools/%E0%A4%A');

    expect(meta.title).toBe('MCP tool detail');
    expect(meta.breadcrumbs.at(-1)).toEqual({ label: '%E0%A4%A' });
  });

  test('trims query terms in vector route chrome copy', () => {
    expect(routeMeta('/vector/search', '?q=%20oracle%20').description).toBe('Preview semantic matches for “oracle”.');
    expect(routeMeta('/vector/results', '?q=%20oracle%20').breadcrumbs.at(-1)).toEqual({ label: 'Results: oracle' });
  });
});
