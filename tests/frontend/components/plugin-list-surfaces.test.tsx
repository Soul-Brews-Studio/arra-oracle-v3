import { describe, expect, test } from 'bun:test';
import { PluginList, pluginSurfaceBadgePath, pluginSurfaceRows } from '../../../frontend/src/components/PluginList';
import { surfacesFor } from '../../../frontend/src/plugin-surfaces';
import { htmlFor } from '../_render';

describe('PluginList surfaces', () => {
  test('renders plugin surface badges, server command, and MCP tool count', () => {
    const plugin = {
      name: 'echo',
      file: 'echo.wasm',
      size: 10,
      modified: 'now',
      version: '1.0.0',
      surfaces: ['apiRoutes', 'proxy'],
      description: 'Echo plugin',
      menu: { label: 'Echo', group: 'tools' as const },
      server: { command: 'bun', args: ['echo.ts'], healthPath: '/ready' },
      mcpTools: [{ name: 'echo.say', description: 'Say echo' }],
      apiRoutes: [{ path: '/api/echo', methods: ['POST'] }],
      proxy: [{ path: '/proxy/echo', targetEnv: 'ECHO_URL', methods: ['GET'] }],
      cliSubcommands: [{ command: 'echo', help: 'Echo input' }],
      exportFormats: [{ extension: 'echo', name: 'Echo format' }],
    };
    const html = htmlFor(
      <PluginList plugins={[plugin]} />,
    );
    expect(pluginSurfaceRows(plugin).map((row) => row.href)).toContain('/mcp?q=echo&source=plugin');
    expect(html).toContain('wasm');
    expect(html).toContain('menu');
    expect(html).toContain('server');
    expect(html).toContain('mcp');
    expect(html).toContain('apiRoutes');
    expect(html).toContain('proxy');
    expect(html).toContain('href="/plugins?q=echo&amp;surface=apiRoutes"');
    expect(html).toContain('href="/plugins?q=echo&amp;surface=mcp"');
    expect(html).toContain('href="/plugins?q=echo&amp;surface=server"');
    expect(html).toContain('href="/mcp?q=echo&amp;source=plugin"');
    expect(html).toContain('bun echo.ts · /ready');
    expect(html).toContain('Surface details');
    expect(html).toContain('echo.say');
    expect(html).toContain('POST /api/echo');
    expect(html).toContain('GET /proxy/echo → $ECHO_URL');
    expect(html).toContain('CLI subcommands');
    expect(html).toContain('.echo');
  });

  test('normalizes backend mcpTools surface names for badges', () => {
    expect(surfacesFor({ name: 'echo', file: '', size: 0, modified: 'now', surfaces: ['mcpTools'] })).toEqual(['mcp']);
  });

  test('builds shareable inventory links for plugin surface badges', () => {
    expect(pluginSurfaceBadgePath('echo tools', 'mcp')).toBe('/plugins?q=echo+tools&surface=mcp');
    expect(pluginSurfaceBadgePath('metadata-only', 'metadata')).toBe('/plugins?q=metadata-only&surface=metadata');
  });
});
