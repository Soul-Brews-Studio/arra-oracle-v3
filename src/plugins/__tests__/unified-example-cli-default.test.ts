import { expect, test } from 'bun:test';

import { canvasInspectCli } from '../../../docs/examples/unified-plugin/index.ts';

test('reference unified plugin CLI handler defaults to all canvases', () => {
  expect(canvasInspectCli({ source: 'cli', plugin: 'canvas-inspector' })).toEqual({
    ok: true,
    output: 'canvas-inspector:all menu=/tools/canvas-inspector',
  });
});
