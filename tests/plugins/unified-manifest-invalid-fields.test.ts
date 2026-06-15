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
      [{ ...base, mcpTools: [{ name: 'ok_tool', description: 'x', inputSchema: {}, handler: 1 }] }, /handler/],
      [{ ...base, apiRoutes: [{ path: 'relative' }] }, /apiRoutes.path/],
      [{ ...base, apiRoutes: [{ path: '/ok', methods: 'GET' }] }, /apiRoutes.methods/],
      [{ ...base, apiRoutes: [{ path: '/ok', methods: ['BREW'] }] }, /invalid method/],
      [{ ...base, proxy: [{ path: '/proxy' }] }, /proxy.targetEnv/],
      [{ ...base, menu: [{ path: '/menu' }] }, /menu.label/],
      [{ ...base, cliSubcommands: [{ help: 'Missing command' }] }, /cliSubcommands.command/],
      [{ ...base, cliSubcommands: [{ command: 'go' }] }, /cliSubcommands.help/],
    ];

    for (const [manifest, message] of cases) {
      expect(() => normalizeUnifiedPluginManifest(manifest)).toThrow(message);
    }
  });
});
