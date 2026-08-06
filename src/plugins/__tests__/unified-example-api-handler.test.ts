import { expect, test } from 'bun:test';

import canvasInspectorDefault, {
  canvasInspectorRoute,
} from '../../../docs/examples/unified-plugin/index.ts';

test('reference unified plugin API handler returns no-embedder metadata', () => {
  expect(canvasInspectorDefault).toBe(canvasInspectorRoute);
  expect(canvasInspectorRoute({ source: 'api', plugin: 'canvas-inspector' })).toEqual({
    ok: true,
    body: {
      plugin: 'canvas-inspector',
      surface: 'apiRoutes',
      method: 'GET',
      id: 'all',
      menuPath: '/tools/canvas-inspector',
      cliCommand: 'canvas-inspect',
      embedderRequired: false,
    },
  });
});
