import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { pluginsRouter } from '../index.ts';

describe('/api/plugins?kind=canvas', () => {
  test('returns CanvasPlugin metadata without scanning installed wasm plugins', async () => {
    const app = new Elysia().use(pluginsRouter);
    const response = await app.handle(new Request('http://localhost/api/plugins?kind=canvas'));
    const body = await response.json() as {
      kind: string;
      plugins: Array<{ id: string; kind: string; renderer: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.kind).toBe('canvas');
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'wave', kind: 'three', renderer: 'Three' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'map', kind: 'react', renderer: 'React' }));
    expect(body.plugins).toContainEqual(expect.objectContaining({ id: 'planets', kind: 'react', renderer: 'React' }));
  });
});
