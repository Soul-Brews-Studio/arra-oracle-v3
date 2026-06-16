import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../plugin.json' with { type: 'json' };
import { manifestSurfaces, normalizeUnifiedPluginManifest } from '../../src/plugins/unified-manifest.ts';

test('arra maw plugin declares modern dual surfaces and swappable backend config', () => {
  expect(manifest).toMatchObject({
    name: 'arra',
    target: 'js',
    entry: './index.ts',
    cli: { command: 'arra' },
    api: { path: '/api/arra' },
    config: { dbBackend: 'http', embedderBackend: 'none' },
  });
  expect(manifest.menu.map((item) => item.path)).toContain('/plugins/arra');
  expect(manifest.mcpTools[0]).toMatchObject({ name: 'oracle_arra_read', handler: 'default', readOnly: true });
  expect(manifest.mcpTools[0].inputSchema.properties.command.enum).toContain('search');
  expect(manifest.configSchema.properties.dbBackend.enum).toEqual(['http', 'sqlite', 'memory', 'custom']);
});

test('arra maw plugin normalizes with MCP tool metadata', () => {
  const normalized = normalizeUnifiedPluginManifest(manifest);

  expect(manifestSurfaces(normalized)).toEqual(expect.arrayContaining(['mcpTools', 'apiRoutes', 'menu', 'cliSubcommands']));
  expect(normalized.mcpTools.map((tool) => tool.name)).toEqual(['oracle_arra_read']);
});

test('arra maw plugin records a verifiable entry artifact hash', () => {
  const entry = join(import.meta.dir, '..', manifest.artifact.path);
  const sha256 = createHash('sha256').update(readFileSync(entry)).digest('hex');

  expect(manifest.artifact).toEqual({ path: './index.ts', sha256 });
});
