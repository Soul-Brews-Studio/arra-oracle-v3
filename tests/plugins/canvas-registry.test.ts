import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { listCanvasPlugins, findCanvasPlugin } from '../../src/canvas/plugins.ts';
import { createPluginsRouter } from '../../src/routes/plugins/index.ts';
import { canvasPluginsCommand } from '../../src/cli/commands/canvas-plugins.ts';

describe('canvas plugin registry', () => {
  test('registers three and react canvas plugins', () => {
    const plugins = listCanvasPlugins();
    expect(plugins.map((plugin) => plugin.id)).toContain('wave');
    expect(plugins.map((plugin) => plugin.id)).toContain('map');
    expect(plugins.map((plugin) => plugin.id)).toContain('planets');
    expect(listCanvasPlugins('react').map((plugin) => plugin.id)).toEqual(['map', 'planets']);
    expect(findCanvasPlugin('map')).toMatchObject({ kind: 'react', renderer: 'KnowledgeMapCanvas' });
  });

  test('exposes canvas plugins through plugin registry HTTP route', async () => {
    const app = new Elysia().use(createPluginsRouter());
    const response = await app.handle(new Request('http://local/api/plugins/canvas?kind=react'));
    expect(response.status).toBe(200);
    const body = await response.json() as { count: number; standalone: { host: string }; plugins: Array<{ id: string; kind: string; standalonePath: string }> };
    expect(body.count).toBe(2);
    expect(body.standalone.host).toBe('canvas.buildwithoracle.com');
    expect(body.plugins).toEqual([
      expect.objectContaining({ id: 'map', kind: 'react', standalonePath: '/map' }),
      expect.objectContaining({ id: 'planets', kind: 'react', standalonePath: '/planets' }),
    ]);
  });


  test('exposes standalone metadata through plugin detail route', async () => {
    const app = new Elysia().use(createPluginsRouter());
    const response = await app.handle(new Request('http://local/api/plugins/canvas/wave'));
    const body = await response.json() as { plugin: { id: string; standalonePath: string } };

    expect(response.status).toBe(200);
    expect(body.plugin).toMatchObject({ id: 'wave', standalonePath: '/?plugin=wave' });
  });

  test('lists canvas plugins through CLI command', async () => {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => lines.push(String(message));
    try {
      expect(await canvasPluginsCommand(['canvas-plugins', '--kind', 'react'])).toBe(0);
    } finally {
      console.log = originalLog;
    }
    expect(lines.join('\n')).toContain('map\treact\tKnowledge Map');
    expect(lines.join('\n')).toContain('planets\treact\tPlanets');
  });
});
