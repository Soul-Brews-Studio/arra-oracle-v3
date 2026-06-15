import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPO_ROOT } from '../smoke/_helpers.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeEchoMcpServer(): string {
  const dir = tempDir('arra-e2e-external-mcp-');
  const script = join(dir, 'echo.mjs');
  writeFileSync(script, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'echo-e2e', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'echo', description: 'Echo message', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: String(request.params.arguments?.message ?? '') }],
}));
await server.connect(new StdioServerTransport());
`);
  return script;
}

function oracleEnv(dataDir: string): Record<string, string> {
  return {
    ...process.env,
    HOME: tempDir('arra-e2e-home-'),
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_HTTP_URL: 'http://127.0.0.1:1',
    ORACLE_EMBEDDER: 'none',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
  } as Record<string, string>;
}

test('MCP tool call flow lists tools, calls one, and returns the external result', async () => {
  const dataDir = tempDir('arra-e2e-mcp-data-');
  const external = writeEchoMcpServer();
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(REPO_ROOT, 'src/index.ts')],
    cwd: REPO_ROOT,
    env: oracleEnv(dataDir),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-e2e-mcp-flow', version: '0.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    expect(toolNames).toContain('oracle_mcp_list_tools');
    expect(toolNames).toContain('oracle_mcp_call');

    const externalList = await client.callTool({
      name: 'oracle_mcp_list_tools',
      arguments: { command: 'bun', args: [external], cwd: REPO_ROOT },
    }) as { content?: Array<{ text: string }>; isError?: boolean };
    expect(externalList.isError).not.toBe(true);
    expect(externalList.content?.[0]?.text).toContain('"name": "echo"');

    const result = await client.callTool({
      name: 'oracle_mcp_call',
      arguments: { command: 'bun', args: [external], cwd: REPO_ROOT, toolName: 'echo', toolArgs: { message: 'mcp-flow-ok' } },
    }) as { content?: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.text).toContain('mcp-flow-ok');
  } finally {
    await client.close();
  }
}, 20_000);
