import { describe, expect, test } from 'bun:test';
import { fetchCanvasPlugins } from '../../../frontend/src/api/canvas-plugins';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchCanvasPlugins standalone metadata', () => {
  test('preserves canvas host and standalone plugin paths', async () => {
    const fetchMock = installFetch(() => jsonResponse({
      plugins: [{
        id: 'map',
        label: 'Knowledge Map',
        description: 'React map.',
        kind: 'react',
        renderer: 'React',
        standalonePath: '/map',
        apiPath: '/api/map3d',
      }],
      count: 1,
      kind: 'canvas',
      standalone: { host: 'canvas.buildwithoracle.com', defaultPlugin: 'wave' },
    }));
    try {
      await expect(fetchCanvasPlugins()).resolves.toMatchObject({
        plugins: [{ id: 'map', standalonePath: '/map' }],
        standalone: { host: 'canvas.buildwithoracle.com' },
      });
      expect(fetchMock.calls[0]?.input).toBe('/api/plugins?kind=canvas');
    } finally {
      fetchMock.restore();
    }
  });

  test('requests kind-scoped canvas registry endpoints for runtime filters', async () => {
    const fetchMock = installFetch(() => jsonResponse({ plugins: [], count: 0, kind: 'react' }));
    try {
      await fetchCanvasPlugins('react');
      expect(fetchMock.calls[0]?.input).toBe('/api/canvas/plugins?kind=react');
    } finally {
      fetchMock.restore();
    }
  });
});
