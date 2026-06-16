import { canvasServeSummary, createCanvasStandaloneApp, parseCanvasServeOptions } from '../../canvas/standalone.ts';

function printUsage(): void {
  console.log('Usage: bun run src/cli/index.ts canvas-serve [--port N] [--api-base URL] [--host HOST] [--dry-run] [--json]');
}

export async function canvasServeCommand(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return 0;
  }
  try {
    const options = parseCanvasServeOptions(args.slice(1));
    const summary = canvasServeSummary(options);
    if (args.includes('--dry-run')) {
      console.log(args.includes('--json') ? JSON.stringify(summary, null, 2) : `Canvas standalone ready at ${summary.url}`);
      return 0;
    }
    const app = createCanvasStandaloneApp({ ORACLE_API_BASE: options.apiBase });
    const server = Bun.serve({ hostname: options.hostname, port: options.port, fetch: (request) => app.handle(request) });
    console.log(`Canvas standalone serving ${summary.host} on http://${options.hostname}:${server.port}`);
    return await new Promise<number>((resolve) => {
      const stop = () => { server.stop(); resolve(0); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
