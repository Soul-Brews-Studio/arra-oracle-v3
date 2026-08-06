import { describe, expect, test } from 'bun:test';
import manifest from '../../../tools/maw-plugin-arra/plugin.json';
import handler, { commandRegistry } from '../../../tools/maw-plugin-arra/index.ts';

describe('maw-plugin-arra dual surface contract', () => {
  test('declares modern CLI, API, and menu surfaces in one manifest', () => {
    expect(manifest).toMatchObject({
      name: 'arra',
      target: 'js',
      entry: './index.ts',
      artifact: { path: 'dist/index.js', sha256: null },
      config: { dbBackend: 'http', embedderBackend: 'none' },
      cli: { command: 'arra' },
      api: { path: '/api/plugins/arra', methods: ['GET', 'POST'] },
    });
    expect(manifest.menu[0]).toMatchObject({ label: 'ARRA Oracle', path: '/plugins/arra' });
    expect(manifest.configSchema.properties.dbBackend.enum).toEqual(['http', 'sqlite', 'memory', 'custom']);
    expect(manifest.configSchema.properties.embedderBackend.enum).toEqual(['none', 'local', 'remote']);
  });

  test('serves the shared command registry for menu/API callers', async () => {
    const result = await handler({ source: 'api', args: {} });
    const body = JSON.parse(result.output ?? '{}');

    expect(result.ok).toBe(true);
    expect(body.menu.path).toBe('/plugins/arra');
    expect(body.api.path).toBe('/api/plugins/arra');
    expect(body.config).toMatchObject({ dbBackend: 'http', embedderBackend: 'none' });
    expect(body.configSchema.properties.embedderBackend.enum).toEqual(['none', 'local', 'remote']);
    expect(body.commands.map((item: { name: string }) => item.name))
      .toEqual(commandRegistry.map((item) => item.name));
    expect(body.commands.map((item: { name: string }) => item.name)).toContain('commands');
    expect(body.commands.every((item: { surfaces: string[] }) => item.surfaces.includes('cli') && item.surfaces.includes('menu'))).toBe(true);
  });

  test('runs commands through API args without duplicating dispatch', async () => {
    const result = await handler({ source: 'api', args: { command: 'help' } });
    const body = JSON.parse(result.output ?? '{}');

    expect(result.ok).toBe(true);
    expect(body.command).toBe('help');
    expect(body.output).toContain('maw arra');
    expect(body.output).toContain('vector-config');
  });

  test('exposes swappable backend config via CLI and API registry', async () => {
    const text = await handler({ args: ['config'] });
    const raw = await handler({ source: 'api', args: { command: 'config', args: ['--json'] } });
    const body = JSON.parse(JSON.parse(raw.output ?? '{}').output);

    expect(text.ok).toBe(true);
    expect(text.output).toContain('dbBackend: http');
    expect(text.output).toContain('embedderBackend: none');
    expect(raw.ok).toBe(true);
    expect(body.configSchema.properties.dbBackend.enum).toContain('custom');
    expect(body.configSchema.properties.embedderBackend.enum).toContain('remote');
  });

  test('runs the explicit command registry from CLI text and JSON', async () => {
    const text = await handler({ args: ['commands'] });

    expect(text.ok).toBe(true);
    expect(text.output).toContain('shared by CLI/API/menu');
    expect(text.output).toContain('vector-config');

    const raw = await handler({ args: ['commands', '--json'] });
    const body = JSON.parse(raw.output ?? '{}');

    expect(raw.ok).toBe(true);
    expect(body.source).toBe('cli');
    expect(body.commands.map((item: { name: string }) => item.name))
      .toEqual(commandRegistry.map((item) => item.name));
  });

  test('returns modern InvokeResult exit codes for dispatch failures', async () => {
    const missing = await handler({ args: ['missing'] });
    const failed = await handler({ args: ['vector-config', 'add', 'missing-model'] });

    expect(missing).toMatchObject({ ok: false, exitCode: 2 });
    expect(missing.error).toContain('maw arra');
    expect(failed).toEqual({ ok: false, error: 'add requires --model <model>', exitCode: 1 });
  });

});
