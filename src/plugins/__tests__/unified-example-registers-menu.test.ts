import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadUnifiedPlugins } from '../unified-loader.ts';

test('unified loader registers the example menu row metadata', async () => {
  const runtime = await loadUnifiedPlugins({ dirs: [join(process.cwd(), 'docs/examples')] });

  expect(runtime.menu).toEqual([{ label: 'Canvas Inspector', path: '/tools/canvas-inspector', group: 'tools', order: 82, plugin: 'canvas-inspector' }]);
});
