#!/usr/bin/env bun
/**
 * `bun run pointers:backfill` — populate oracle_pointer_index (#2880).
 *
 * A backfill nobody can run is indistinguishable from no backfill, which is most of why the
 * table sat at 0 rows against 35,179 documents. This entry point exists so the sweep is
 * reachable without writing a script first.
 *
 * Flags: --limit N · --dry-run
 */
import { sqlite } from '../db/index.ts';
import { runPointerBackfill } from './pointer-backfill.ts';

function flagValue(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const raw = Number(process.argv[i + 1]);
  return Number.isFinite(raw) ? raw : undefined;
}

const dryRun = process.argv.includes('--dry-run');
const before = (sqlite.prepare('SELECT COUNT(*) AS n FROM oracle_pointer_index').get() as { n: number }).n;
const docs = (sqlite.prepare('SELECT COUNT(*) AS n FROM oracle_documents').get() as { n: number }).n;
console.log(`[pointer-backfill] ${docs} documents, ${before} pointer rows`);

if (dryRun) {
  console.log('[pointer-backfill] --dry-run: nothing written');
  process.exit(0);
}

const result = runPointerBackfill(sqlite, {
  limit: flagValue('--limit'),
  logger: console,
});

if (result.errors.length > 0) {
  console.error(`[pointer-backfill] ${result.errors.length} error(s); first: ${result.errors[0]}`);
  process.exit(1);
}
