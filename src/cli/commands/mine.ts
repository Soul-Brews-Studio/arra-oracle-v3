import { mineFolder, watchMineFolder } from '../../indexer/mine.ts';

export interface MineCliOptions { dir?: string; dbPath?: string; dryRun: boolean; watch: boolean; help: boolean }

export function parseMineArgs(args: string[]): MineCliOptions {
  const options: MineCliOptions = { dryRun: false, watch: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--watch' || arg === '-w') options.watch = true;
    else if (arg === '--db-path') {
      const value = args[++i]?.trim();
      if (!value) throw new Error('--db-path requires a path');
      options.dbPath = value;
    } else if (arg?.startsWith('--db-path=')) {
      const value = arg.slice('--db-path='.length).trim();
      if (!value) throw new Error('--db-path requires a path');
      options.dbPath = value;
    } else if (arg?.startsWith('-')) {
      throw new Error(`unknown mine option: ${arg}`);
    } else if (!options.dir) options.dir = arg;
    else throw new Error(`unexpected mine argument: ${arg}`);
  }
  return options;
}

export function mineHelp(): string {
  return [
    'Usage: arra mine <dir> [--watch] [--db-path <file>] [--dry-run]',
    'Ingest a folder into Oracle memory with deterministic IDs and safe re-runs.',
    '',
    'Defaults: indexes .md, .mdx, and .txt files; skips unchanged content.',
    'Use --watch to keep re-ingesting the folder when files change.',
  ].join('\n');
}

export async function mineCommand(args: string[]): Promise<number> {
  let options: MineCliOptions;
  try { options = parseMineArgs(args); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); console.error(mineHelp()); return 1; }
  if (options.help) { console.log(mineHelp()); return 0; }
  if (!options.dir) { console.error('mine requires a directory'); console.error(mineHelp()); return 1; }
  const print = (r: { stored: number; scanned: number; skipped: number; project: string }) => {
    console.log(`Mined ${r.stored} document${r.stored === 1 ? '' : 's'} from ${r.scanned} file${r.scanned === 1 ? '' : 's'} (${r.skipped} skipped) into project "${r.project}".`);
  };
  try {
    if (options.watch) {
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      console.log(`Watching ${options.dir} for changes...`);
      await watchMineFolder({ ...options, dir: options.dir, signal: controller.signal }, print);
    } else print(await mineFolder(options as { dir: string; dbPath?: string; dryRun?: boolean }));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
