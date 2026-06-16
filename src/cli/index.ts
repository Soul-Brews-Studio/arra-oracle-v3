#!/usr/bin/env bun

import { exportCommand } from './commands/export.ts';
import { serveCommand } from './commands/serve.ts';
import { canvasPluginsCommand } from './commands/canvas-plugins.ts';

function printUsage(): void {
  console.error('usage: bun run src/cli/index.ts <export|serve|canvas-plugins> ...');
  console.error('  export: bun run src/cli/index.ts export --format json|markdown [--out <file>]');
  console.error('  serve:  bun run src/cli/index.ts serve <start|stop|status> [--foreground|--background] [--json]');
  console.error('  canvas-plugins: bun run src/cli/index.ts canvas-plugins [--kind three|react] [--id <id>] [--json]');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (args[0] === 'serve') process.exit(await serveCommand(args));
  if (args[0] === 'canvas-plugins') process.exit(await canvasPluginsCommand(args));
  if (args[0] === 'export') process.exit(await exportCommand(args));

  console.error(`unknown command: ${args[0]}`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
