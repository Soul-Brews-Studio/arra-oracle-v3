import { describe, expect, test } from 'bun:test';
import { normalizeUnifiedPluginManifest } from '../../src/plugins/unified-manifest.ts';

const base = { name: 'invalid-pack', version: '1.0.0', entry: './index.ts' };

describe('unified manifest field validation', () => {
  test('rejects malformed fields with specific validation messages', () => {
    const cases: Array<[unknown, RegExp]> = [
      [null, /JSON object/],
      [{ ...base, name: 'Bad_Name' }, /manifest.name/],
      [{ ...base, version: 'next' }, /manifest.version/],
      [{ ...base, entry: 42 }, /manifest.entry/],
      [{ ...base, depends: ['ok', 42] }, /depends/],
      [{ ...base, mcpTools: [{ name: 'Bad', description: 'x', inputSchema: {}, handler: 'h' }] }, /mcpTools.name/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', inputSchema: {}, handler: 'h' }] }, /description/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: [], handler: 'h' }] }, /inputSchema/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: {}, handler: 1 }] }, /handler/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: {}, handler: 'h', readOnly: 'yes' }] }, /readOnly/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: {}, handler: 'h', enabled: 'no' }] }, /enabled/],
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: {}, handler: 'h', enabledByDefault: 'no' }] }, /enabledByDefault/],
      [{ ...base, apiRoutes: [{ path: 'relative' }] }, /apiRoutes.path/],
      [{ ...base, apiRoutes: [{ path: '/ok', methods: 'GET' }] }, /apiRoutes.methods/],
      [{ ...base, apiRoutes: [{ path: '/ok', methods: ['BREW'] }] }, /invalid method/],
      [{ ...base, apiRoutes: [{ path: '/ok', handler: '   ' }] }, /apiRoutes.handler/],
      [{ ...base, proxy: [{ path: '/proxy' }] }, /proxy.targetEnv/],
      [{ ...base, proxy: [{ path: '/proxy', targetEnv: '   ' }] }, /proxy.targetEnv/],
      [{ ...base, server: { command: '   ' } }, /server.command/],
      [{ ...base, server: { command: 'bun', env: [] } }, /server.env/],
      [{ ...base, menu: [{ path: '/menu' }] }, /menu.label/],
      [{ ...base, menu: [{ path: '/menu', label: '   ' }] }, /menu.label/],
      [{ ...base, cliSubcommands: [{ help: 'Missing command' }] }, /cliSubcommands.command/],
      [{ ...base, cliSubcommands: [{ command: 'go' }] }, /cliSubcommands.help/],
      [{ ...base, cliSubcommands: [{ command: 'go', help: 'Go', handler: '' }] }, /cliSubcommands.handler/],
      [{ ...base, lifecycle: { init: '' } }, /lifecycle.init/],
    ];

    for (const [manifest, message] of cases) {
      expect(() => normalizeUnifiedPluginManifest(manifest)).toThrow(message);
    }
  });
});
