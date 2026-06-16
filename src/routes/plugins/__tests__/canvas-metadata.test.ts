import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createPluginsRouter } from '../index.ts';

describe('/api/plugins?kind=canvas', () => {
  test('returns CanvasPlugin metadata without scanning installed wasm plugins', async () => {
    const app = new Elysia().use(createPluginsRouter({
      registry: () => { throw new Error('installed plugin registry should not load for canvas metadata'); },
    }));
    const response = await app.handle(new Request('http://localhost/api/plugins?kind=canvas'));
    const body = await response.json() as {
      kind: string;
      count: number;
      plugins: Array<{ id: string; kind: string; renderer: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.kind).toBe('canvas');
    expect(body.count).toBe(body.plugins.length);
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'wave', kind: 'three', renderer: 'Three' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'map', kind: 'react', renderer: 'React' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'planets', kind: 'react', renderer: 'React' }));
  });
});
