import { describe, expect, test } from 'bun:test';
import { PluginsPage, enabledStateForPlugins, pluginAdminSummary } from '../../../frontend/src/pages/PluginsPage';
import { htmlFor } from '../_render';

describe('PluginsPage admin view', () => {
  test('renders version status and toggle controls for registered plugins', () => {
    const plugins = [{ name: 'canvas', file: '', size: 0, modified: 'now', version: '1.2.3', status: 'ok' }];
    const html = htmlFor(<PluginsPage plugins={plugins} loading={false} />);

    expect(pluginAdminSummary(plugins, enabledStateForPlugins(plugins))).toBe('1 enabled · 0 disabled · 1 registered');
    expect(html).toContain('GET /api/v1/plugins');
    expect(html).toContain('canvas');
    expect(html).toContain('1.2.3');
    expect(html).toContain('ok');
    expect(html).toContain('Disable canvas');
  });
});
