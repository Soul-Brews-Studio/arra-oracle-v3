import { exportOracleData } from './exporter.ts';

type Writer = (message: string) => void;
type ProgressFormat = 'text' | 'json';

interface CliOptions {
  outputDir: string;
  dbPath?: string;
  progressFormat: ProgressFormat;
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`missing value for ${flag}`);
    return value;
  }
  const prefix = `${flag}=`;
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (value === '') throw new Error(`missing value for ${flag}`);
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  const outputDir = readValue(args, '--output') ?? readValue(args, '-o');
  if (!outputDir) throw new Error('missing required --output <dir>');
  const progress = readValue(args, '--progress') ?? 'text';
  if (progress !== 'text' && progress !== 'json') throw new Error('invalid --progress: expected text or json');
  return { outputDir, dbPath: readValue(args, '--db'), progressFormat: progress };
}

function printHelp(write: Writer): void {
  write([
    'bun run tools/export-app/index.ts --output ./backup/ [--db ./oracle.db]',
    '',
    'Exports Oracle docs plus all Drizzle collections without starting the server.',
    '',
    'Flags:',
    '  --output, -o <dir>   destination backup directory',
    '  --db <path>          SQLite database path (defaults to ORACLE_DB_PATH)',
    '  --progress <mode>    progress output: text (default) or json',
    '  --help, -h           show this help',
    '',
  ].join('\n'));
}

function progressWriter(format: ProgressFormat, write: Writer): Writer {
  if (format === 'json') {
    return (message) => write(`${JSON.stringify({ event: 'progress', message })}\n`);
  }
  return (message) => write(`${message}\n`);
}

export async function runExportApp(args: string[], stdout: Writer = process.stdout.write.bind(process.stdout), stderr: Writer = process.stderr.write.bind(process.stderr)): Promise<number> {
  try {
    if (args.includes('--help') || args.includes('-h')) {
      printHelp(stdout);
      return 0;
    }
    const options = parseArgs(args);
    const result = await exportOracleData({ ...options, progress: progressWriter(options.progressFormat, stderr) });
    stdout(`${JSON.stringify({ success: true, ...result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await runExportApp(Bun.argv.slice(2));
  process.exit(code);
}
