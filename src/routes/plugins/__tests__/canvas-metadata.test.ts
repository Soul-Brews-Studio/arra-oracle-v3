import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { canvasPluginMetadataRegistry } from '../../../canvas/metadata.ts';
import { listCanvasPlugins } from '../../../canvas/plugins.ts';
import { createPluginsRouter } from '../index.ts';

describe('/api/plugins?kind=canvas', () => {
  test('returns CanvasPlugin metadata without scanning installed wasm plugins', async () => {
    const app = new Elysia().use(createPluginsRouter({
      registry: () => { throw new Error('installed plugin registry should not load for canvas metadata'); },
      canvasMetadataRegistry: canvasPluginMetadataRegistry,
    }));
    const response = await app.handle(new Request('http://localhost/api/plugins?kind=canvas'));
    const body = await response.json() as {
      kind: string;
      count: number;
      standalone: { host: string };
      plugins: Array<{ id: string; kind: string; renderer: string; standalonePath?: string; apiPath?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.kind).toBe('canvas');
    expect(body.count).toBe(body.plugins.length);
    expect(body.plugins.map((plugin) => plugin.id)).toEqual(listCanvasPlugins().map((plugin) => plugin.id));
    expect(body.standalone.host).toBe('canvas.buildwithoracle.com');
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'wave', kind: 'three', renderer: 'Three' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'map', kind: 'react', renderer: 'React', standalonePath: '/map', apiPath: '/api/map3d' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'planets', kind: 'react', renderer: 'React', standalonePath: '/planets', apiPath: '/api/map3d' }));
  });
});
