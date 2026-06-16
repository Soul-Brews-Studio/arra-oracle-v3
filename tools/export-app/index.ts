import { existsSync, statSync } from 'node:fs';
import { DB_PATH } from '../../src/config.ts';
import { exportOracleData } from './exporter.ts';
import { previewOracleExport } from './summary.ts';

type Writer = (message: string) => void;

interface CliOptions {
  outputDir: string;
  dbPath?: string;
  quiet: boolean;
  progressJson: boolean;
  dryRun: boolean;
}

function flagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`missing value for ${flag}`);
  return value;
}

function assignedValue(arg: string, flag: string): string | undefined {
  const prefix = `${flag}=`;
  if (!arg.startsWith(prefix)) return undefined;
  const value = arg.slice(prefix.length);
  if (value === '') throw new Error(`missing value for ${flag}`);
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  let outputDir: string | undefined;
  let dbPath: string | undefined;
  let quiet = false;
  let progressJson = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const outputAssigned = assignedValue(arg, '--output');
    const dbAssigned = assignedValue(arg, '--db');
    if (outputAssigned !== undefined) { outputDir = outputAssigned; continue; }
    if (dbAssigned !== undefined) { dbPath = dbAssigned; continue; }
    if (arg === '--output' || arg === '-o') { outputDir = flagValue(args, i, arg); i += 1; continue; }
    if (arg === '--db') { dbPath = flagValue(args, i, arg); i += 1; continue; }
    if (arg === '--quiet' || arg === '--no-progress') { quiet = true; continue; }
    if (arg === '--progress-json') { progressJson = true; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--help' || arg === '-h') continue;
    throw new Error(arg.startsWith('-') ? `unknown flag: ${arg}` : `unexpected argument: ${arg}`);
  }

  if (!outputDir) throw new Error('missing required --output <dir>');
  return { outputDir, dbPath, quiet, progressJson, dryRun };
}

function requireFile(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`database file not found: ${path}. Pass --db <path> for an existing Oracle database.`);
  }
  if (!statSync(path).isFile()) throw new Error(`database path is not a file: ${path}`);
}

function requireOutputTarget(path: string): void {
  if (existsSync(path) && !statSync(path).isDirectory()) {
    throw new Error(`output path exists but is not a directory: ${path}`);
  }
}

export function validateCliOptions(options: CliOptions): void {
  requireFile(options.dbPath ?? DB_PATH);
  requireOutputTarget(options.outputDir);
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
    '  --dry-run            print collection counts without writing files',
    '  --quiet              suppress progress output',
    '  --no-progress        alias for --quiet',
    '  --progress-json      emit progress as JSON lines on stderr',
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
    validateCliOptions(options);
    if (options.dryRun) {
      stdout(`${JSON.stringify({ success: true, dryRun: true, ...previewOracleExport({ dbPath: options.dbPath }) }, null, 2)}\n`);
      return 0;
    }
    const progress = options.quiet
      ? () => {}
      : options.progressJson
        ? (message: string) => stderr(`${JSON.stringify({ event: 'export_progress', message })}\n`)
        : (message: string) => stderr(`${message}\n`);
    const result = await exportOracleData({
      outputDir: options.outputDir,
      dbPath: options.dbPath,
      progress,
    });
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
