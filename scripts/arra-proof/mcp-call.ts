/**
 * MCP door of the #3110 proof: start the real stdio MCP server (src/index.ts) against a running
 * arra (ORACLE_API), call the arra_* aliases, print each result. Same calls a Claude/Codex MCP
 * client makes.
 *
 *   ORACLE_API=http://127.0.0.1:47944 bun scripts/arra-proof/mcp-call.ts arra_status '{}' arra_hub '{"action":"nodes"}'
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '../..');
const pairs = process.argv.slice(2);
if (!process.env.ORACLE_API || pairs.length % 2) {
  console.error('usage: ORACLE_API=http://127.0.0.1:<port> bun scripts/arra-proof/mcp-call.ts <tool> <json-args> [...]');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'bun',
  args: [join(repo, 'src/index.ts')],
  env: { ...process.env, ORACLE_API: process.env.ORACLE_API } as Record<string, string>,
  stderr: 'ignore',
});
const client = new Client({ name: 'arra-3110-proof', version: '1.0.0' });
await client.connect(transport);
const listed = await client.listTools();
console.log(`# MCP tools/list: ${listed.tools.filter((t) => ['oracle_status', 'oracle_vault', 'oracle_hub'].includes(t.name)).map((t) => t.name).join(', ')}`);
for (let i = 0; i < pairs.length; i += 2) {
  const name = pairs[i];
  const args = JSON.parse(pairs[i + 1]);
  console.log(`\n# tools/call ${name} ${JSON.stringify(args)}`);
  const result = await client.callTool({ name, arguments: args }) as { content: Array<{ text?: string }>; isError?: boolean };
  const text = result.content.map((c) => c.text ?? '').join('\n');
  try { const j = JSON.parse(text); console.log(JSON.stringify(j.data ?? j, null, 2).slice(0, 1800)); } catch { console.log(text.slice(0, 1800)); }
  if (result.isError) console.log('(isError)');
}
await client.close();
