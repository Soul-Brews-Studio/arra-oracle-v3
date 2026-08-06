import { sweepHuginn } from '../../../src/huginn/sweep.ts';

function value(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function huginnCommand(args: string[]): Promise<number> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    console.log('arra huginn <subcommand>\n');
    console.log('Subcommands:');
    console.log('  sweep    back-fill missed Huginn session captures and unindexed learnings');
    console.log('\nSweep flags: --sessions-dir PATH[:PATH...] --repo-root PATH --lookback-hours N --max-files N --json');
    return 0;
  }
  if (sub !== 'sweep') {
    console.error(`unknown huginn subcommand: ${sub}`);
    return 1;
  }
  const sessionDirs = value(rest, '--sessions-dir')?.split(':').filter(Boolean);
  const lookback = value(rest, '--lookback-hours');
  const maxFiles = value(rest, '--max-files');
  const summary = await sweepHuginn({
    sessionDirs,
    repoRoot: value(rest, '--repo-root'),
    statePath: value(rest, '--state'),
    lookbackHours: lookback ? Number(lookback) : undefined,
    maxFiles: maxFiles ? Number(maxFiles) : undefined,
    log: rest.includes('--json') ? undefined : (message) => console.error(message),
  });
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}
