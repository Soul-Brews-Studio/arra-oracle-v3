import { describe, expect, test } from 'bun:test';
import {
  UnifiedPluginSurfaceOverview,
  pluginCapabilityLinks,
  pluginCapabilityRows,
  pluginServerLinks,
  pluginServerRows,
} from '../../../frontend/src/pages/UnifiedPluginSurfaceOverview';
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
    }, {
      name: 'proxy-only',
      file: '',
      size: 0,
      modified: 'now',
      status: 'ok',
      proxy: [{ path: '/api/plugins/proxy-only/server', targetEnv: 'PROXY_ONLY_URL' }],
    }];

    expect(pluginServerRows(plugins)).toEqual([
      { name: 'echo', status: 'ok', health: '/health', surface: 'server' },
      { name: 'proxy-only', status: 'ok', health: '/api/plugins/proxy-only/server', surface: 'proxy' },
    ]);
    expect(pluginServerLinks(plugins)).toEqual([
      { label: 'echo · ok · /health', href: '/plugins?q=echo&surface=server' },
      { label: 'proxy-only · ok · /api/plugins/proxy-only/server', href: '/plugins?q=proxy-only&surface=proxy' },
    ]);
    expect(pluginCapabilityRows(plugins)).toContain('echo api GET /api/plugins/echo/ping');
    expect(pluginCapabilityRows(plugins)).toContain('echo mcp echo_tool read-only');
    expect(pluginCapabilityLinks(plugins)).toContainEqual({
      label: 'echo mcp echo_tool read-only',
      href: '/mcp/tools/echo_tool',
    });
    const html = htmlFor(<UnifiedPluginSurfaceOverview plugins={plugins} />);
    expect(html).toContain('Menu items');
    expect(html).toContain('MCP tools');
    expect(html).toContain('Plugin servers');
    expect(html).toContain('echo · ok · /health');
    expect(html).toContain('Capabilities');
    expect(html).toContain('echo cli echo');
    expect(html).toContain('echo export echo');
    expect(html).toContain('href="/menu"');
    expect(html).toContain('href="/plugins"');
    expect(html).toContain('href="/mcp"');
    expect(html).toContain('href="/vector"');
    expect(html).toContain('href="/status"');
    expect(html).toContain('href="/storage"');
    expect(html).toContain('href="/plugins?surface=mcp"');
    expect(html).toContain('href="/plugins?surface=server"');
    expect(html).toContain('href="/plugins?q=echo&amp;surface=server"');
    expect(html).toContain('href="/plugins?q=proxy-only&amp;surface=proxy"');
    expect(html).toContain('href="/mcp/tools/echo_tool"');
    expect(html).toContain('href="/plugins?q=%2Fapi%2Fplugins%2Fecho%2Fping&amp;surface=apiRoutes"');
  });
});
