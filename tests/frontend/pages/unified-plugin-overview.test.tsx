import { describe, expect, test } from 'bun:test';
import { UnifiedPluginSurfaceOverview, pluginCapabilityRows, pluginServerRows } from '../../../frontend/src/pages/UnifiedPluginSurfaceOverview';
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
      apiRoutes: [{ path: '/api/plugins/echo/ping', methods: ['GET'] }],
      mcpTools: [{ name: 'echo_tool', description: 'Echo', inputSchema: {}, source: 'plugin', readOnly: true }],
      cliSubcommands: [{ command: 'echo', help: 'Echo input' }],
      exportFormats: [{ extension: 'echo' }],
    }];

    expect(pluginServerRows(plugins)).toEqual([{ name: 'echo', status: 'ok', health: '/health' }]);
    expect(pluginCapabilityRows(plugins)).toContain('echo api GET /api/plugins/echo/ping');
    expect(pluginCapabilityRows(plugins)).toContain('echo mcp echo_tool read-only');
    const html = htmlFor(<UnifiedPluginSurfaceOverview plugins={plugins} />);
    expect(html).toContain('Menu items');
    expect(html).toContain('MCP tools');
    expect(html).toContain('Plugin servers');
    expect(html).toContain('echo · ok · /health');
    expect(html).toContain('Capabilities');
    expect(html).toContain('echo cli echo');
    expect(html).toContain('echo export echo');
  });
});
