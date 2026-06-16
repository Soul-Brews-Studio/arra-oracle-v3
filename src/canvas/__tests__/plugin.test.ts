import { describe, expect, test } from 'bun:test';

import type { CanvasPlugin } from '../index.ts';
import { isCanvasPlugin } from '../index.ts';

describe('CanvasPlugin contract', () => {
  test('accepts Three renderer plugins with a mount function', () => {
    const plugin: CanvasPlugin = {
      id: 'wave',
      label: 'Wave',
      kind: 'three',
      mount: () => {},
    };

    expect(isCanvasPlugin(plugin)).toBe(true);
  });

  test('accepts React renderer plugins with a renderer function', () => {
    const plugin: CanvasPlugin = {
      id: 'planets',
      label: 'Planets',
      kind: 'react',
      renderer: () => null,
    };

    expect(isCanvasPlugin(plugin)).toBe(true);
  });

  test('rejects server/local plugin shaped objects without a frontend renderer', () => {
    expect(isCanvasPlugin({ name: 'federation', tier: 'standard', routes: () => null })).toBe(false);
    expect(isCanvasPlugin({ name: 'menu-plugin', file: 'menu-plugin.wasm', size: 42 })).toBe(false);
  });

  test('rejects whitespace-only plugin identifiers and labels', () => {
    expect(isCanvasPlugin({ id: ' ', label: 'Wave', kind: 'three', mount: () => {} })).toBe(false);
    expect(isCanvasPlugin({ id: 'wave', label: '\t', kind: 'three', mount: () => {} })).toBe(false);
  });
});
