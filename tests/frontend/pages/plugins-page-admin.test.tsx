import { describe, expect, test } from 'bun:test';
import { PluginsPage, enabledStateForPlugins, pluginAdminSummary, pluginRouteRows } from '../../../frontend/src/pages/PluginsPage';
import { htmlFor } from '../_render';

describe('PluginsPage admin view', () => {
  test('renders version status, health, and routes for installed plugins', () => {
    const plugins = [{
      name: 'canvas',
      file: '',
      size: 0,
      modified: 'now',
      version: '1.2.3',
      status: 'ok',
      menu: { label: 'Canvas', path: '/canvas/plugins' },
      apiRoutes: [{ path: '/api/plugins/canvas', methods: ['GET', 'POST'] }],
      proxy: [{ path: '/api/plugins/canvas/server', targetEnv: 'CANVAS_URL' }],
      server: { command: 'bun', healthPath: '/health' },
    }];
    const html = htmlFor(<PluginsPage plugins={plugins} loading={false} />);

    expect(pluginAdminSummary(plugins, enabledStateForPlugins(plugins))).toBe('1 enabled · 0 disabled · 1 registered');
    expect(pluginRouteRows(plugins[0]).map((route) => route.path)).toEqual([
      '/canvas/plugins',
      '/api/plugins/canvas',
      '/api/plugins/canvas/server',
      '/api/plugins/canvas/server/health',
    ]);
    expect(html).toContain('GET /api/v1/plugins');
    expect(html).toContain('canvas');
    expect(html).toContain('1.2.3');
    expect(html).toContain('active');
    expect(html).toContain('healthy');
    expect(html).toContain('Routes');
    expect(html).toContain('GET|POST');
    expect(html).toContain('/api/plugins/canvas/server/health');
  });
});
