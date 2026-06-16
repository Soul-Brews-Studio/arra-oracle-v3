import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { callExternalMcpTool, listExternalMcpTools } from '../client.ts';

const repoRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeFixtureServer(): string {
  const dir = mkdtempSync(join(repoRoot, '.tmp-mcp-fixture-'));
  tempDirs.push(dir);
  const script = join(dir, 'server.mjs');
  writeFileSync(script, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'fixture', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: 'text', text: JSON.stringify({ echo: request.params.arguments?.message ?? null }) }] }));
await server.connect(new StdioServerTransport());
`);
  return script;
}

describe('MCP-IN stdio client', () => {
  it('lists tools from an external MCP server', async () => {
    const script = writeFixtureServer();
    const tools = await listExternalMcpTools({ command: 'bun', args: [script], cwd: repoRoot });
    expect(tools).toEqual([{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }]);
  }, 10_000);

  it('calls one external MCP tool as input', async () => {
    const script = writeFixtureServer();
    const result = await callExternalMcpTool({ command: 'bun', args: [script], cwd: repoRoot, toolName: 'echo', toolArgs: { message: 'hello' } });
    expect(result.content?.[0]?.type).toBe('text');
    expect(result.content?.[0]?.text).toBe('{"echo":"hello"}');
  }, 10_000);
});
