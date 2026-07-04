import { describe, expect, test } from 'bun:test';

import { listCanvasPlugins } from '../plugins.ts';
import { CANVAS_PLUGIN_METADATA, canvasPluginMetadataRegistry, listCanvasPluginMetadata } from '../metadata.ts';

describe('canvas plugin metadata', () => {
  test('derives plugin metadata from the canonical canvas registry', () => {
    const pluginIds = listCanvasPlugins().map((plugin) => plugin.id);
    const metadataIds = CANVAS_PLUGIN_METADATA.map((plugin) => plugin.id);
    const apiIds = listCanvasPluginMetadata().plugins.map((plugin) => plugin.id);

    expect(metadataIds).toEqual(pluginIds);
    expect(apiIds).toEqual(pluginIds);
  });

  test('adds the standalone registry envelope for API responses', () => {
    const registry = canvasPluginMetadataRegistry();

    expect(registry.kind).toBe('canvas');
    expect(registry.count).toBe(registry.plugins.length);
    expect(registry.standalone.host).toBe('canvas.buildwithoracle.com');
  });

  test('keeps standalone URLs and data APIs on generated metadata', () => {
    const metadata = listCanvasPluginMetadata().plugins;

    expect(metadata.find((plugin) => plugin.id === 'wave')).toMatchObject({ renderer: 'Three', standalonePath: '/?plugin=wave' });
    expect(metadata.find((plugin) => plugin.id === 'map3d')).toMatchObject({ renderer: 'Three', standalonePath: '/?plugin=map3d', apiPath: '/api/map3d' });
    expect(metadata.find((plugin) => plugin.id === 'map')).toMatchObject({ renderer: 'React', standalonePath: '/map', apiPath: '/api/map3d' });
  });
});
