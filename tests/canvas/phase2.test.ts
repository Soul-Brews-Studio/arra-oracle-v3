import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { canvasRoutes } from '../../src/routes/canvas/index.ts';
import { canvasServeCommand } from '../../src/cli/commands/canvas-serve.ts';
import { createCanvasStandaloneApp, parseCanvasServeOptions } from '../../src/canvas/standalone.ts';
import { discoverPlugins } from '../../cli/src/plugin/loader.ts';
import { pluginCliCommands } from '../../cli/src/plugin/registry.ts';

describe('canvas phase 2 HTTP and standalone surfaces', () => {
  test('exposes canvas registry through dedicated HTTP routes', async () => {
    const app = new Elysia().use(canvasRoutes);
    const response = await app.handle(new Request('http://local/api/canvas/plugins?kind=react'));
    const body = await response.json() as { count: number; plugins: Array<{ id: string; kind: string }> };

    expect(response.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.plugins.map((plugin) => plugin.id)).toEqual(['map', 'planets']);
  });

  test('returns 404 for unknown canvas plugin ids', async () => {
    const app = new Elysia().use(canvasRoutes);
    const response = await app.handle(new Request('http://local/api/canvas/plugins/missing'));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'canvas plugin not found', id: 'missing' });
  });

  test('standalone app serves canvas HTML and registry API together', async () => {
    const app = createCanvasStandaloneApp({ ORACLE_API_BASE: 'https://oracle.example.test' });
    const html = await app.handle(new Request('http://canvas.local/?plugin=wave'));
    const registry = await app.handle(new Request('http://canvas.local/api/canvas/registry'));

    expect(html.status).toBe(200);
    expect(await html.text()).toContain('plugin=wave');
    expect((await registry.json() as { standalone: { host: string } }).standalone.host).toBe('canvas.buildwithoracle.com');
  });

  test('bundled CLI registry exposes canvas-serve command', async () => {
    const result = await discoverPlugins({ userPluginDir: '/tmp/missing-user-plugins' });
    const commands = result.plugins.flatMap(pluginCliCommands).map((entry) => entry.command);

    expect(commands).toContain('canvas-serve');
  });

  test('canvas-serve supports dry-run without binding a port', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => lines.push(String(message));
    try {
      expect(parseCanvasServeOptions(['--port', '47780']).port).toBe(47780);
      expect(await canvasServeCommand(['canvas-serve', '--port', '47780', '--dry-run', '--json'])).toBe(0);
    } finally {
      console.log = originalLog;
    }
    expect(JSON.parse(lines[0])).toMatchObject({ port: 47780, host: 'canvas.buildwithoracle.com' });
  });
});

test('rejects invalid canvas plugin kind filters', async () => {
  const app = new Elysia().use(canvasRoutes);
  const plugins = await app.handle(new Request('http://local/api/canvas/plugins?kind=video'));
  const registry = await app.handle(new Request('http://local/api/canvas/registry?kind=video'));

  expect(plugins.status).toBe(400);
  expect(registry.status).toBe(400);
  expect(await plugins.json()).toEqual({ error: 'Invalid canvas plugin kind', kind: 'video', allowed: ['three', 'react'] });
});
