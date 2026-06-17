#!/usr/bin/env bun
/** Claude MCP launcher that works from project and plugin scopes. */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function launcherRoot(metaUrl = import.meta.url): string {
  return dirname(dirname(Bun.fileURLToPath(metaUrl)));
}

export function mcpEntrypoint(root = launcherRoot()): string {
  return join(root, 'src', 'index.ts');
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const root = launcherRoot();
  const entry = mcpEntrypoint(root);
  if (args.includes('--resolve-entry')) {
    console.log(entry);
    return;
  }
  if (!existsSync(entry)) throw new Error(`MCP entrypoint not found: ${entry}`);
  process.env.ORACLE_REPO_ROOT ||= root;
  const mod = await import(pathToFileURL(entry).href) as { main?: () => Promise<void> };
  if (typeof mod.main !== 'function') throw new Error(`MCP entrypoint has no main(): ${entry}`);
  await mod.main();
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
