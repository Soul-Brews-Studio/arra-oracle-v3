#!/usr/bin/env bun
/** Arra Oracle MCP Server entry point. */

import { OracleMCPServer } from './mcp/server.ts';
export { OracleMCPServer } from './mcp/server.ts';
export { resolveToolName } from './mcp/aliases.ts';

export async function main(): Promise<void> {
  const readOnly = process.env.ORACLE_READ_ONLY === 'true' || process.argv.includes('--read-only');
  const server = new OracleMCPServer({ readOnly });
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
