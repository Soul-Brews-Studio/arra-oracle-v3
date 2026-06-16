import { describe, expect, test } from 'bun:test';
import {
  PluginsPage,
  enabledStateForPlugins,
  filteredPluginsFor,
  pluginAdminSummary,
  pluginFiltersFromSearch,
  pluginSurfaceFilterOptions,
} from '../../../frontend/src/pages/PluginsPage';
import type { PluginEntry } from '../../../frontend/src/types';
import { htmlFor } from '../_render';

const plugins: PluginEntry[] = [
  { name: 'canvas', file: '', size: 0, modified: 'now', version: '1.2.3', status: 'ok' },
  { name: 'echo', file: 'echo.wasm', size: 0, modified: 'now', mcpTools: [{ name: 'echo.say', description: 'Say echo' }] },
  { name: 'archive', file: '', size: 0, modified: 'now', status: 'disabled' },
  { name: 'broken', file: '', size: 0, modified: 'now', error: 'health check failed' },
];

describe('PluginsPage admin view', () => {
  test('renders version status and health for installed plugins', () => {
    const html = htmlFor(<PluginsPage plugins={[plugins[0]]} loading={false} />);

    expect(pluginAdminSummary([plugins[0]], enabledStateForPlugins([plugins[0]]))).toBe('1 enabled · 0 disabled · 1 registered');
    expect(html).toContain('GET /api/plugins');
    expect(html).toContain('canvas');
    expect(html).toContain('1.2.3');
    expect(html).toContain('ok');
    expect(html).toContain('healthy');
    expect(html).toContain('Unified backend surfaces');
  });

  test('filters plugin inventory by query, visibility, and health', () => {
    const enabled = enabledStateForPlugins(plugins);
    expect(filteredPluginsFor(plugins, enabled, 'echo.say', 'all').map((plugin) => plugin.name)).toEqual(['echo']);
    expect(filteredPluginsFor(plugins, enabled, '', 'disabled').map((plugin) => plugin.name)).toEqual(['archive']);
    expect(filteredPluginsFor(plugins, enabled, '', 'unhealthy').map((plugin) => plugin.name)).toEqual(['broken']);
    expect(filteredPluginsFor(plugins, enabled, '', 'all', 'mcp').map((plugin) => plugin.name)).toEqual(['echo']);
    expect(pluginSurfaceFilterOptions(plugins)).toEqual(['mcp', 'metadata', 'wasm']);

    const html = htmlFor(<PluginsPage plugins={plugins} loading={false} initialQuery="echo.say" />);
    expect(html).toContain('Find plugin surfaces');
    expect(html).toContain('Showing 1 of 4 plugins');
    expect(html).toContain('echo');
    expect(html).toContain('Clear filters');
    expect(html).toContain('All surfaces');
  });

  test('hydrates plugin filters from shareable route search params', () => {
    expect(pluginFiltersFromSearch('?q=echo&visibility=enabled&surface=mcp')).toEqual({
      query: 'echo',
      visibility: 'enabled',
      surface: 'mcp',
    });
    expect(pluginFiltersFromSearch('?visibility=bad&surface=unknown')).toEqual({
      query: '',
      visibility: 'all',
      surface: 'all',
    });

    const html = htmlFor(<PluginsPage plugins={plugins} loading={false} initialSearch="?surface=mcp" />);
    expect(html).toContain('Showing 1 of 4 plugins');
    expect(html).toContain('echo');
    expect(html).toContain('value="mcp" selected');
    expect(html).toContain('href="/plugins?surface=mcp"');
  });

  test('renders a no-match state for filtered plugin inventory', () => {
    const html = htmlFor(<PluginsPage plugins={plugins} loading={false} initialQuery="missing-plugin" />);
    expect(html).toContain('Showing 0 of 4 plugins');
    expect(html).toContain('No plugins match the current filters.');
  });
});
