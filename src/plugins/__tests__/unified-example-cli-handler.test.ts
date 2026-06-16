import { expect, test } from 'bun:test';

import { canvasInspectCli } from '../../../docs/examples/unified-plugin/index.ts';

test('reference unified plugin CLI handler formats explicit target output', () => {
  expect(canvasInspectCli({ source: 'cli', plugin: 'canvas-inspector', args: ['demo'] })).toEqual({
    ok: true,
    output: 'canvas-inspector:demo menu=/tools/canvas-inspector',
  });
});
