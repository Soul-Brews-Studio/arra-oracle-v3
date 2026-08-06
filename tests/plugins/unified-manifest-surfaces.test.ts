import { describe, expect, test } from 'bun:test';
import {
  manifestSurfaces,
  mcpToolNamesForToggle,
  normalizeUnifiedPluginManifest,
  publicUnifiedServerManifest,
} from '../../src/plugins/unified-manifest.ts';

describe('unified manifest surface helpers', () => {
  test('lists every registered surface and redacts private server env', () => {
    const manifest = normalizeUnifiedPluginManifest({
      name: 'surface-pack',
      version: '1.0.0',
      entry: './index.ts',
      mcpTools: [{ name: 'surface_tool', description: 'Surface tool', inputSchema: {}, handler: 'tool' }],
      apiRoutes: [{ path: '/surface', methods: ['GET'] }],
      proxy: [{ path: '/proxy', targetEnv: 'SURFACE_URL', methods: ['POST'] }],
      server: {
        command: 'bun',
        args: ['run', 'dev'],
        env: { SECRET: 'redacted' },
        healthPath: '/health',
        autostart: false,
      },
      menu: [{ label: 'Surface', path: '/surface', group: 'tools' }],
      cliSubcommands: [{ command: 'surface', help: 'Run surface' }],
    });

    expect(manifestSurfaces(manifest)).toEqual([
      'mcpTools',
      'apiRoutes',
      'proxy',
      'server',
      'menu',
      'cliSubcommands',
    ]);
    expect(mcpToolNamesForToggle(manifest)).toEqual(['surface_tool']);
    expect(publicUnifiedServerManifest(manifest.server)).toEqual({
      command: 'bun',
      args: ['run', 'dev'],
      healthPath: '/health',
      autostart: false,
    });
    expect(publicUnifiedServerManifest()).toBeUndefined();
  });
});
