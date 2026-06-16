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
    expect(html).toContain('MCP tools');
  });
});
