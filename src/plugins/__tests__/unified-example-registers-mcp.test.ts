import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadUnifiedPlugins } from '../unified-loader.ts';

test('unified loader registers the example MCP tool metadata', async () => {
  const runtime = await loadUnifiedPlugins({ dirs: [join(process.cwd(), 'docs/examples')] });

  expect(runtime.mcpTools.map((tool) => ({ name: tool.name, plugin: tool.plugin }))).toEqual([
    { name: 'oracle_canvas_inspect', plugin: 'canvas-inspector' },
  ]);
});
