import { expect, test } from 'bun:test';

import { inspectCanvasPlugin } from '../../../docs/examples/unified-plugin/index.ts';

test('reference unified plugin MCP handler returns read-only metadata', () => {
  expect(inspectCanvasPlugin({ source: 'mcp', plugin: 'canvas-inspector' })).toEqual({
    ok: true,
    body: { plugin: 'canvas-inspector', surface: 'mcpTools', readOnly: true },
  });
});
