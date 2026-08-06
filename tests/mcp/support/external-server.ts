import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function writeExternalMcpServer(): { script: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'arra-mcp-fixture-'));
  const script = join(dir, 'external.mjs');
  writeFileSync(script, `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'external', version: '0.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({ content: [{ type: 'text', text: String(request.params.arguments?.message ?? '') + String(process.env.MCP_TEST_SUFFIX ?? '') }] }));
await server.connect(new StdioServerTransport());
`);
  return { script, cleanup: () => rmSync(dir, { recursive: true }) };
}
