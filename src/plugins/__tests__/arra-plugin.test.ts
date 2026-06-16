import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins } from '../unified-loader.ts';

const pluginRoot = join(process.cwd(), 'src/plugins');

describe('built-in arra plugin', () => {
  test('declares modern maw-js CLI, menu, and HTTP surfaces', () => {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, 'arra/plugin.json'), 'utf8'));

    expect(manifest.name).toBe('arra');
    expect(manifest.entry).toBe('./index.ts');
    expect(manifest.cli.command).toBe('arra');
    expect(manifest.cli.handler).toBe('arraCli');
    expect(manifest.verbs).toEqual(['help', 'version', 'menu', 'status']);
    expect(manifest.httpRoutes[0].path).toBe('/api/plugins/arra');
  });

  test('loads and serves the shared ARRA plugin registry route', async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginRoot] });
    const arra = runtime.pluginRegistry().find((plugin) => plugin.name === 'arra');

    expect(arra?.surfaces).toEqual(['apiRoutes', 'menu', 'cliSubcommands']);
    expect(runtime.menu.find((item) => item.plugin === 'arra')?.path).toBe('/plugins/arra');
    const command = runtime.cliSubcommands.find((item) => item.plugin === 'arra');
    expect(command?.command).toBe('arra');
    expect(command?.handler).toBe('arraCli');

    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as never);
    const response = await app.handle(new Request('http://local/api/plugins/arra'));
    const body = await response.json() as { plugin: string; embedderRequired: boolean; verbs: Array<{ name: string }> };

    expect(response.status).toBe(200);
    expect(body.plugin).toBe('arra');
    expect(body.embedderRequired).toBe(false);
    expect(body.verbs.map((verb) => verb.name)).toEqual(['help', 'version', 'menu', 'status']);
  });
});
