import { describe, expect, test } from 'bun:test';
import { PluginList } from '../../../frontend/src/components/PluginList';
import { htmlFor } from '../_render';

describe('PluginList surfaces', () => {
  test('renders plugin surface badges, server command, and MCP tool count', () => {
    const html = htmlFor(
      <PluginList
        plugins={[{
          name: 'echo',
          file: 'echo.wasm',
          size: 10,
          modified: 'now',
          version: '1.0.0',
          surfaces: ['apiRoutes', 'proxy'],
          description: 'Echo plugin',
          menu: { label: 'Echo', group: 'tools' },
          server: { command: 'bun', args: ['echo.ts'], healthPath: '/ready' },
          mcpTools: [{ name: 'echo.say', description: 'Say echo' }],
          apiRoutes: [{ path: '/api/echo', methods: ['POST'] }],
          proxy: [{ path: '/proxy/echo', targetEnv: 'ECHO_URL', methods: ['GET'] }],
          cliSubcommands: [{ command: 'echo', help: 'Echo input' }],
          exportFormats: [{ extension: 'echo', name: 'Echo format' }],
        }]} 
      />,
    );
    expect(html).toContain('wasm');
    expect(html).toContain('menu');
    expect(html).toContain('server');
    expect(html).toContain('mcp');
    expect(html).toContain('apiRoutes');
    expect(html).toContain('proxy');
    expect(html).toContain('bun echo.ts · /ready');
    expect(html).toContain('Surface details');
    expect(html).toContain('echo.say');
    expect(html).toContain('POST /api/echo');
    expect(html).toContain('GET /proxy/echo → $ECHO_URL');
    expect(html).toContain('CLI subcommands');
    expect(html).toContain('.echo');
  });
});
