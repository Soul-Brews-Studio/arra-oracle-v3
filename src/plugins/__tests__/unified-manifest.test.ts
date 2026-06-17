import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  manifestSurfaces,
  mcpToolNamesForToggle,
  normalizeUnifiedPluginManifest,
} from '../unified-manifest.ts';

describe('unified plugin manifest schema', () => {
  test('normalizes reference plugin with multiple capability surfaces', () => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'docs/examples/unified-plugin/plugin.json'), 'utf8'));
    const manifest = normalizeUnifiedPluginManifest(raw);

    expect(manifest.name).toBe('canvas-inspector');
    expect(manifestSurfaces(manifest)).toEqual(['mcpTools', 'apiRoutes', 'menu', 'cliSubcommands']);
    expect(mcpToolNamesForToggle(manifest)).toEqual(['oracle_canvas_inspect']);
  });

  test('maps legacy ServerPlugin/CLI aliases into unified surfaces', () => {
    const manifest = normalizeUnifiedPluginManifest({
      name: 'legacy-bridge',
      version: '1.0.0',
      entry: './index.ts',
      sdk: '^0.0.1',
      api: { path: '/api/legacy-bridge', methods: ['GET'] },
      cli: { command: 'legacy-bridge', help: 'legacy bridge command' },
    });

    expect(manifest.apiRoutes).toEqual([{ path: '/api/legacy-bridge', methods: ['GET'], handler: 'default' }]);
    expect(manifest.cliSubcommands).toEqual([{ command: 'legacy-bridge', help: 'legacy bridge command', handler: 'default' }]);
    expect(manifestSurfaces(manifest)).toEqual(['apiRoutes', 'cliSubcommands']);
  });

  test('keeps disabled MCP declarations but excludes them from toggles', () => {
    const manifest = normalizeUnifiedPluginManifest({
      name: 'switch-pack',
      version: '1.0.0',
      entry: './index.ts',
      mcpTools: [
        { name: 'switch_on', description: 'on', inputSchema: {}, handler: 'run' },
        { name: 'switch_off', description: 'off', inputSchema: {}, handler: 'run', enabled: false },
      ],
    });

    expect(manifest.mcpTools.map((tool) => tool.name)).toEqual(['switch_on', 'switch_off']);
    expect(manifestSurfaces(manifest)).toEqual(['mcpTools']);
    expect(mcpToolNamesForToggle(manifest)).toEqual(['switch_on']);
  });

  test('rejects invalid MCP tool names before registry wiring', () => {
    expect(() => normalizeUnifiedPluginManifest({
      name: 'bad-tool',
      version: '1.0.0',
      entry: './index.ts',
      mcpTools: [{ name: 'Bad Tool', description: 'bad', inputSchema: {}, handler: 'run' }],
    })).toThrow('mcpTools.name');
  });
});
