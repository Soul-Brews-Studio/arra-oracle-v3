import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { loadUnifiedPlugins } from '../unified-loader.ts';

test('unified loader registers the example CLI subcommand metadata', async () => {
  const runtime = await loadUnifiedPlugins({ dirs: [join(process.cwd(), 'docs/examples')] });

  expect(runtime.cliSubcommands).toEqual([{ command: 'canvas-inspect', help: 'Inspect canvas plugin metadata', handler: 'canvasInspectCli', plugin: 'canvas-inspector' }]);
});
