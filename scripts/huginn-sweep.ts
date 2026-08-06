#!/usr/bin/env bun
import { sweepHuginn } from '../src/huginn/sweep.ts';

function value(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const args = Bun.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: bun scripts/huginn-sweep.ts [--sessions-dir PATH[:PATH...]] [--repo-root PATH] [--lookback-hours N] [--max-files N] [--json]\n\nBack-fill missed Huginn captures from recent session JSONL and unindexed ψ/memory/learnings markdown.`);
  process.exit(0);
}

const sessionDirs = value(args, '--sessions-dir')?.split(':').filter(Boolean);
const lookback = value(args, '--lookback-hours');
const maxFiles = value(args, '--max-files');

const summary = await sweepHuginn({
  sessionDirs,
  repoRoot: value(args, '--repo-root'),
  statePath: value(args, '--state'),
  lookbackHours: lookback ? Number(lookback) : undefined,
  maxFiles: maxFiles ? Number(maxFiles) : undefined,
  log: args.includes('--json') ? undefined : (message) => console.error(message),
});

console.log(JSON.stringify(summary, null, 2));
