import { exportMarkdownData } from './exporter.ts';

type Writer = (message: string) => void;

interface CliOptions {
  outputDir: string;
  dbPath?: string;
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
  return { outputDir, dbPath: readValue(args, '--db') };
}

function printHelp(write: Writer): void {
  write([
    'bun run tools/export-app/index.ts --output ./backup/ [--db ./oracle.db]',
    '',
    'Exports all Drizzle schema collections as per-row Markdown files.',
    '',
    'Flags:',
    '  --output, -o <dir>   destination backup directory',
    '  --db <path>          SQLite database path (defaults to ORACLE_DB_PATH)',
    '  --help, -h           show this help',
    '',
  ].join('\n'));
}

export async function runExportApp(args: string[], stdout: Writer = process.stdout.write.bind(process.stdout), stderr: Writer = process.stderr.write.bind(process.stderr)): Promise<number> {
  try {
    if (args.includes('--help') || args.includes('-h')) {
      printHelp(stdout);
      return 0;
    }
    const options = parseArgs(args);
    const result = await exportMarkdownData({ ...options, progress: (message) => stderr(`${message}\n`) });
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
