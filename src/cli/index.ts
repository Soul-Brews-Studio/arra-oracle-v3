#!/usr/bin/env bun

import { exportCommand } from './commands/export.ts';
import { serveCommand } from './commands/serve.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: bun run src/cli/index.ts <export|serve> ...');
    console.error('  export: bun run src/cli/index.ts export --format json|markdown [--out <file>]');
    console.error('  serve:  bun run src/cli/index.ts serve <start|stop|status> [--foreground|--background] [--json]');
    process.exit(1);
  }

  if (args[0] === 'serve') {
    process.exit(await serveCommand(args));
  }

  if (args[0] !== 'export') {
    console.error(`unknown command: ${args[0]}`);
    console.error('usage: bun run src/cli/index.ts <export|serve> ...');
    console.error('  export: bun run src/cli/index.ts export --format json|markdown [--out <file>]');
    console.error('  serve:  bun run src/cli/index.ts serve <start|stop|status> [--foreground|--background] [--json]');
    process.exit(1);
  }

  process.exit(await exportCommand(args));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
