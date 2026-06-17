import { describe, expect, test } from 'bun:test';

import { canvasPluginDataPath } from '../index.ts';
import { findCanvasPlugin, listCanvasPlugins } from '../plugins.ts';
import { parseCanvasKind } from '../registry.ts';

describe('canvas registry edge cases', () => {
  test('normalizes kind filters while rejecting non-string values', () => {
    expect(parseCanvasKind(' React ')).toBe('react');
    expect(parseCanvasKind('THREE')).toBe('three');
    expect(parseCanvasKind('video')).toBeUndefined();
    expect(parseCanvasKind(['react'])).toBeUndefined();
  });

  test('trims plugin id lookup for CLI and URL inputs', () => {
    expect(findCanvasPlugin(' map ')).toMatchObject({ id: 'map', kind: 'react' });
    expect(canvasPluginDataPath(' planets ')).toBe('/api/map3d');
  });

  test('returns defensive copies instead of mutable registry singletons', () => {
    const first = listCanvasPlugins()[0];
    if (!first) throw new Error('expected canvas plugin fixture');
    const original = { id: first.id, label: first.label, query: first.query.plugin };

    first.label = 'Mutated Label';
    first.query.plugin = 'mutated';

    expect(findCanvasPlugin(original.id)).toMatchObject({
      id: original.id,
      label: original.label,
      query: { plugin: original.query },
    });
    expect(listCanvasPlugins()[0]).toMatchObject({
      id: original.id,
      label: original.label,
      query: { plugin: original.query },
    });
  });
});
