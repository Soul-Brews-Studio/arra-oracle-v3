import { existsSync, statSync } from 'node:fs';
import { DB_PATH } from '../../src/config.ts';
import { exportOracleData, type ExportProgressEvent } from './exporter.ts';
import { previewOracleExport } from './summary.ts';
import { appendCollectionFilter } from './collections.ts';
import { verifyExportBundle } from './verify.ts';

type Writer = (message: string) => void;
type ProgressMode = 'text' | 'json' | 'silent';

interface CliOptions {
  outputDir: string;
  dbPath?: string;
  quiet: boolean;
  progressMode: ProgressMode;
  dryRun: boolean;
  verifyDir?: string;
  collections: string[];
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
  let progressMode: ProgressMode = 'text';
  let dryRun = false;
  let verifyDir: string | undefined;
  let collections: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const outputAssigned = assignedValue(arg, '--output');
    const dbAssigned = assignedValue(arg, '--db');
    const progressAssigned = assignedValue(arg, '--progress');
    const verifyAssigned = assignedValue(arg, '--verify');
    const collectionAssigned = assignedValue(arg, '--collection') ?? assignedValue(arg, '--collections');
    if (outputAssigned !== undefined) { outputDir = outputAssigned; continue; }
    if (dbAssigned !== undefined) { dbPath = dbAssigned; continue; }
    if (progressAssigned !== undefined) { progressMode = readProgressMode(progressAssigned); continue; }
    if (verifyAssigned !== undefined) { verifyDir = verifyAssigned; continue; }
    if (collectionAssigned !== undefined) { collections = appendCollectionFilter(collections, collectionAssigned); continue; }
    if (arg === '--output' || arg === '-o') { outputDir = flagValue(args, i, arg); i += 1; continue; }
    if (arg === '--db') { dbPath = flagValue(args, i, arg); i += 1; continue; }
    if (arg === '--progress') { progressMode = readProgressMode(flagValue(args, i, arg)); i += 1; continue; }
    if (arg === '--verify') { verifyDir = flagValue(args, i, arg); i += 1; continue; }
    if (arg === '--collection' || arg === '--collections') {
      collections = appendCollectionFilter(collections, flagValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg === '--quiet' || arg === '--no-progress') { quiet = true; continue; }
    if (arg === '--progress-json') { progressMode = 'json'; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--help' || arg === '-h') continue;
    throw new Error(arg.startsWith('-') ? `unknown flag: ${arg}` : `unexpected argument: ${arg}`);
  }

  if (verifyDir && outputDir) throw new Error('--verify cannot be combined with --output');
  if (!outputDir && !verifyDir) throw new Error('missing required --output <dir>');
  return { outputDir: outputDir ?? verifyDir!, dbPath, quiet, progressMode, dryRun, verifyDir, collections };
}

function readProgressMode(value: string): ProgressMode {
  if (value === 'text' || value === 'json' || value === 'silent') return value;
  throw new Error('invalid --progress: expected text, json, or silent');
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
    '  --collection <name>  export only matching collection; repeat or comma-separate',
    '  --progress <mode>    progress output: text, json, or silent',
    '  --dry-run            print collection counts without writing files',
    '  --verify <dir>       verify manifest file sizes and SHA-256 checksums',
    '  --quiet              suppress progress output',
    '  --no-progress        alias for --quiet',
    '  --progress-json      emit progress as JSON lines on stderr',
    '  --help, -h           show this help',
    '',
  ].join('\n'));
}

function progressWriter(options: CliOptions, write: Writer) {
  if (options.quiet || options.progressMode === 'silent') return () => {};
  if (options.progressMode === 'json') {
    return (message: string, event?: ExportProgressEvent) => {
      const payload = event
        ? { event: 'export_progress', type: 'export-progress', message, ...event }
        : { event: 'export_progress', type: 'export-progress', message };
      write(`${JSON.stringify(payload)}\n`);
    };
  }
  return (message: string) => write(`${message}\n`);
}

export async function runExportApp(args: string[], stdout: Writer = process.stdout.write.bind(process.stdout), stderr: Writer = process.stderr.write.bind(process.stderr)): Promise<number> {
  try {
    if (args.includes('--help') || args.includes('-h')) {
      printHelp(stdout);
      return 0;
    }
    const options = parseArgs(args);
    if (options.verifyDir) {
      const result = await verifyExportBundle(options.verifyDir);
      stdout(`${JSON.stringify({ success: result.ok, verified: result.ok, ...result }, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    validateCliOptions(options);
    if (options.dryRun) {
      stdout(`${JSON.stringify({ success: true, dryRun: true, ...previewOracleExport({ dbPath: options.dbPath, collections: options.collections }) }, null, 2)}\n`);
      return 0;
    }
    const progress = progressWriter(options, stderr);
    const result = await exportOracleData({
      outputDir: options.outputDir,
      dbPath: options.dbPath,
      collections: options.collections,
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
