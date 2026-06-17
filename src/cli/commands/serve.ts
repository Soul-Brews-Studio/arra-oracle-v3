import { serveCli } from '../../plugins/arra/serve-cli.ts';

type ServePlan =
  | { kind: 'delegate'; args: string[] }
  | { kind: 'foreground' }
  | { kind: 'usage'; exitCode: number }
  | { kind: 'error'; message: string };

const BACKGROUND_FLAGS = new Set(['--background', '-b']);
const FOREGROUND_FLAGS = new Set(['--foreground', '-f']);
const START_ALIASES = new Set(['start', 'background', 'daemon', 'bg']);

export async function serveCommand(args: string[]): Promise<number> {
  const plan = serveCommandPlan(args);
  if (plan.kind === 'usage') {
    printUsage();
    return plan.exitCode;
  }
  if (plan.kind === 'error') {
    console.error(plan.message);
    printUsage();
    return 1;
  }
  if (plan.kind === 'foreground') return runServerForeground();

  const result = await serveCli(plan.args);
  if (result.output) console.log(result.output);
  if (result.error) console.error(result.error);
  return result.ok ? 0 : 1;
}

export function serveCommandPlan(args: string[]): ServePlan {
  if (args[0] !== 'serve') return { kind: 'usage', exitCode: 1 };
  if (args.includes('--help') || args.includes('-h')) return { kind: 'usage', exitCode: 0 };

  const sub = args[1]?.toLowerCase();
  const rest = args.slice(sub ? 2 : 1);
  const foreground = sub === 'foreground' || rest.some((arg) => FOREGROUND_FLAGS.has(arg));
  const background = START_ALIASES.has(sub ?? 'start') || rest.some((arg) => BACKGROUND_FLAGS.has(arg));

  if (foreground && background && (sub === 'foreground' || rest.some((arg) => BACKGROUND_FLAGS.has(arg)))) {
    return { kind: 'error', message: 'Cannot use --foreground and --background together' };
  }
  if (foreground) return { kind: 'foreground' };
  if (!sub) return { kind: 'delegate', args: filterCliOnlyFlags(rest) };
  if (START_ALIASES.has(sub)) return { kind: 'delegate', args: ['start', ...filterCliOnlyFlags(rest)] };
  if (sub === 'status' || sub === 'stop') return { kind: 'delegate', args: [sub, ...rest] };
  return { kind: 'error', message: `unknown serve subcommand: ${sub}` };
}

function filterCliOnlyFlags(args: string[]): string[] {
  return args.filter((arg) => !BACKGROUND_FLAGS.has(arg));
}

async function runServerForeground(): Promise<number> {
  const { startServer } = await import('../../server.ts');
  const server = await startServer();

  console.log(`🔮 Oracle server running in foreground on http://localhost:${server.port}`);

  return await new Promise<number>((resolve) => {
    const handle = () => {
      server.stop();
      resolve(0);
    };
    process.once('SIGINT', handle);
    process.once('SIGTERM', handle);
  });
}

function printUsage(): void {
  console.log('Usage: bun run src/cli/index.ts serve <start|stop|status> [--port N] [--foreground|--background] [--json]');
  console.log('');
  console.log('Commands:');
  console.log('  start [--port N] [--background]     Start server in background (default)');
  console.log('  start --foreground                  Start server in this process');
  console.log('  status [--port N] [--json]          Show running status');
  console.log('  stop [--port N]                     Stop running server');
}
