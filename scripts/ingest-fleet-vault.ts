#!/usr/bin/env bun
import { ingestVaultInbox } from '../src/fleet-log/vault-ingest.ts';

function value(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = Bun.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: bun scripts/ingest-fleet-vault.ts [--repo-root PATH] [--db PATH]\n\nIngest this repo's ψ/inbox/*.md vault messages into fleet_messages.`);
  process.exit(0);
}

const summary = ingestVaultInbox({
  repoRoot: value(args, '--repo-root'),
  dbPath: value(args, '--db'),
});

console.log(JSON.stringify(summary, null, 2));
