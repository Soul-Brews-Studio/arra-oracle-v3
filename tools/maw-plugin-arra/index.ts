import { runExportCommand } from './commands/export.ts';
import { runStatusCommand } from './commands/status.ts';

type InvokeContext = {
  source?: string;
  args?: string[] | Record<string, unknown>;
  writer?: (line?: string) => void;
};

type InvokeResult = { ok: boolean; output?: string; error?: string };
type CommandHandler = (args: string[]) => Promise<string>;

const commandHandlers: Record<string, CommandHandler> = {
  export: runExportCommand,
  status: () => runStatusCommand(),
};

export const command = {
  name: 'arra',
  description: 'ARRA Oracle CLI bridge — export vector collections and inspect status.',
};

function argsFromContext(args: InvokeContext['args']): string[] {
  if (Array.isArray(args)) return args;
  if (!args || typeof args !== 'object') return [];
  const sub = typeof args.sub === 'string' ? [args.sub] : [];
  const rest = Object.entries(args).flatMap(([key, value]) => {
    if (key === 'sub' || value === undefined || value === null || value === false) return [];
    if (value === true) return [`--${key.replace(/_/g, '-')}`];
    return [`--${key.replace(/_/g, '-')}`, String(value)];
  });
  return [...sub, ...rest];
}

function help(): string {
  return [
    'maw arra — ARRA Oracle CLI bridge',
    '  status',
    '      show vector collections, doc counts, and health from localhost:47778',
    '  export --collection X --format json|csv|md',
    '      stream a vector collection export from localhost:47778',
  ].join('\n');
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = argsFromContext(ctx.args);
  const subcommand = (args[0] || '').toLowerCase();
  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    return { ok: true, output: help() };
  }

  const run = commandHandlers[subcommand];
  if (!run) return { ok: false, error: help() };

  try {
    const output = await run(args.slice(1));
    if (ctx.writer) ctx.writer(output);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
