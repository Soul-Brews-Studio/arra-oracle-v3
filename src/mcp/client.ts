import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface ExternalMcpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExternalMcpCallInput extends ExternalMcpServerConfig {
  toolName: string;
  toolArgs?: Record<string, unknown>;
}

type ExternalMcpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  return { ...getDefaultEnvironment(), ...(extra ?? {}) };
}

function assertServerConfig(server: ExternalMcpServerConfig): void {
  if (!server || typeof server !== 'object') throw new Error('server config is required');
  if (typeof server.command !== 'string' || !server.command.trim()) {
    throw new Error('command must be a non-empty string');
  }
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) {
    throw new Error('args must be an array of strings');
  }
  if (server.cwd !== undefined && typeof server.cwd !== 'string') throw new Error('cwd must be a string');
  if (server.env !== undefined && (!isStringRecord(server.env))) {
    throw new Error('env must be an object with string values');
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}

async function withClient<T>(server: ExternalMcpServerConfig, run: (client: Client) => Promise<T>): Promise<T> {
  assertServerConfig(server);
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd,
    env: cleanEnv(server.env),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-mcp-in', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close();
  }
}

export async function listExternalMcpTools(server: ExternalMcpServerConfig): Promise<ExternalMcpTool[]> {
  return await withClient(server, async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  });
}

export async function callExternalMcpTool(input: ExternalMcpCallInput) {
  assertServerConfig(input);
  if (typeof input.toolName !== 'string' || !input.toolName.trim()) {
    throw new Error('toolName must be a non-empty string');
  }
  if (input.toolArgs !== undefined && !isStringRecordLike(input.toolArgs)) {
    throw new Error('toolArgs must be an object');
  }
  return await withClient(input, async (client) => {
    return await client.callTool({
      name: input.toolName,
      arguments: input.toolArgs ?? {},
    });
  });
}

function isStringRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
