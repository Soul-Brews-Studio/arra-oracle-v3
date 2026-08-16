#!/usr/bin/env bun
/** Arra Oracle MCP Server entry point. */

import { OracleMCPServer } from './mcp/server.ts';
import { resolveToolName } from './mcp/aliases.ts';
export { OracleMCPServer } from './mcp/server.ts';
export { resolveToolName, deprecatedAliasWarning, resolveInboundToolName, retiredAliasNotice, aliasNotice } from './mcp/aliases.ts';

export type AdvertisedTool = { name: string };

export function filterAdvertisedTools<T extends AdvertisedTool>(
  tools: readonly T[],
  disabledTools: ReadonlySet<string>,
): T[] {
  return tools.filter((tool) => {
    const resolved = resolveToolName(tool.name);
    return !disabledTools.has(tool.name) && !disabledTools.has(resolved);
  });
}

export async function main(): Promise<void> {
  const readOnly = process.env.ORACLE_READ_ONLY === 'true' || process.argv.includes('--read-only');
  const server = new OracleMCPServer({ readOnly });
  // Fire-and-forget, and this seam specifically. `main()` runs before run() → connect() → before
  // `initialize` is even read off stdin, so it is earlier than any SDK hook and costs the
  // handshake nothing; it is also the one seam the in-daemon /mcp route does not pass through,
  // which is what keeps the daemon from ensuring itself.
  //
  // Never await it: ensureServerRunning budgets 15s per health wait (worst path ~38s), which
  // would blow Claude Code's MCP startup timeout and get the server marked failed — and a failed
  // stdio server is not reconnected, so we would lose every tool to save one. The first tool call
  // joins the same memoized promise inside the CallTool handler.
  server.warmHttpDaemon();
  try {
    console.error('[Startup] Pre-connecting to vector store...');
    await server.preConnectVector();
    console.error('[Startup] Vector store pre-connected successfully');
  } catch (e) {
    console.error('[Startup] Vector store pre-connect failed:', e instanceof Error ? e.message : e);
  }
  await server.run();
}

if (import.meta.main) main().catch(console.error);
