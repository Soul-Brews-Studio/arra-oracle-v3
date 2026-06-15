import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeExternalServer(): string {
  const dir = mkdtempSync(join(tmpdir(), 'arra-mcp-in-server-'));
  tempDirs.push(dir);
  const script = join(dir, 'external.mjs');
  writeFileSync(script, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'external', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: 'text', text: String(request.params.arguments?.message ?? '') }] }));
await server.connect(new StdioServerTransport());
`);
  return script;
}

test('Arra MCP-out exposes a manifest MCP-IN tool that calls an external server', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-mcp-in-data-'));
  tempDirs.push(dataDir);
  const external = writeExternalServer();
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    cwd: repoRoot,
    env: { ...process.env, ORACLE_HTTP_URL: 'http://127.0.0.1:1', ORACLE_DATA_DIR: dataDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-mcp-in-e2e', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.some((tool) => tool.name === 'oracle_mcp_call')).toBe(true);
    const result = await client.callTool({
      name: 'oracle_mcp_call',
      arguments: { command: 'bun', args: [external], cwd: repoRoot, toolName: 'echo', toolArgs: { message: 'bridge-ok' } },
    }) as { content?: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.text).toContain('bridge-ok');
  } finally {
    await client.close();
  }
}, 20_000);
