import { describe, expect, test } from 'bun:test';
import { UnifiedPluginSurfaceOverview, pluginServerRows } from '../../../frontend/src/pages/UnifiedPluginSurfaceOverview';
import { htmlFor } from '../_render';

describe('UnifiedPluginSurfaceOverview', () => {
  test('renders plugin server and proxy management details', () => {
    const plugins = [{
      name: 'echo',
      file: '',
      size: 0,
      modified: 'now',
      status: 'ok',
      server: { command: 'bun', healthPath: '/health' },
      proxy: [{ path: '/api/plugins/echo/server', targetEnv: 'ECHO_URL' }],
    }];

    expect(pluginServerRows(plugins)).toEqual([{ name: 'echo', status: 'ok', health: '/health' }]);
    const html = htmlFor(<UnifiedPluginSurfaceOverview plugins={plugins} />);
    expect(html).toContain('Menu items');
    expect(html).toContain('MCP tools');
    expect(html).toContain('Plugin servers');
    expect(html).toContain('echo · ok · /health');
  });
});
