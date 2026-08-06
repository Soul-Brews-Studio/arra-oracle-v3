import { describe, expect, test } from 'bun:test';

import type { CanvasPlugin } from '../index.ts';
import { renderCanvasPlugin } from '../index.ts';

describe('CanvasPlugin host', () => {
  test('routes Three plugins to the Three mount adapter', async () => {
    const calls: string[] = [];
    const plugin: CanvasPlugin = { id: 'wave', label: 'Wave', kind: 'three', mount: () => {} };

    const cleanup = await renderCanvasPlugin(plugin, {
      mountThree: (p) => {
        calls.push(`three:${p.id}`);
        return () => calls.push('cleanup');
      },
      renderReact: (p) => {
        calls.push(`react:${p.id}`);
      },
    });

    cleanup?.();
    expect(calls).toEqual(['three:wave', 'cleanup']);
  });

  test('routes React plugins to the React render adapter', async () => {
    const calls: string[] = [];
    const plugin: CanvasPlugin = { id: 'map', label: 'Map', kind: 'react', renderer: () => null };

    await renderCanvasPlugin(plugin, {
      mountThree: (p) => {
        calls.push(`three:${p.id}`);
      },
      renderReact: (p) => {
        calls.push(`react:${p.id}`);
      },
    });

    expect(calls).toEqual(['react:map']);
  });
});
