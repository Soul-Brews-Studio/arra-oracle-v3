import { statSync } from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface ExternalMcpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
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

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  return { ...getDefaultEnvironment(), ...(extra ?? {}) };
}

function timeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function assertServerConfig(server: ExternalMcpServerConfig): void {
  if (!server || typeof server !== 'object') throw new Error('server config is required');
  if (typeof server.command !== 'string' || !server.command.trim()) {
    throw new Error('command must be a non-empty string');
  }
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) {
    throw new Error('args must be an array of strings');
  }
  if (server.cwd !== undefined) {
    if (typeof server.cwd !== 'string') throw new Error('cwd must be a string');
    try {
      if (!statSync(server.cwd).isDirectory()) throw new Error('not directory');
    } catch {
      throw new Error('cwd must be an existing directory');
    }
  }
  if (server.env !== undefined && (!isStringRecord(server.env))) {
    throw new Error('env must be an object with string values');
  }
  timeoutMs(server.timeoutMs);
}

function isMissingCommand(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeExternalMcpError(error: unknown, command: string, limit: number): Error {
  const message = errorMessage(error);
  if (isMissingCommand(error) || message.includes('ENOENT')) {
    return new Error(`failed to start external MCP server: command not found: ${command}`);
  }
  if (message.includes('Request timed out') || message.includes('timed out')) {
    return new Error(`external MCP server timed out after ${limit}ms`);
  }
  if (message.includes('Connection closed')) {
    return new Error('external MCP server closed before responding');
  }
  return new Error(`external MCP server error: ${message}`);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string');
}

async function withClient<T>(server: ExternalMcpServerConfig, run: (client: Client, limit: number) => Promise<T>): Promise<T> {
  assertServerConfig(server);
  const limit = timeoutMs(server.timeoutMs);
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    cwd: server.cwd,
    env: cleanEnv(server.env),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'arra-mcp-in', version: '0.0.0' }, { capabilities: {} });
  try {
    await client.connect(transport, { timeout: limit });
    return await run(client, limit);
  } catch (error) {
    throw normalizeExternalMcpError(error, server.command.trim(), limit);
  } finally {
    try { await client.close(); } catch {}
  }
}

export async function listExternalMcpTools(server: ExternalMcpServerConfig): Promise<ExternalMcpTool[]> {
  return await withClient(server, async (client, limit) => {
    const result = await client.listTools(undefined, { timeout: limit });
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
  return await withClient(input, async (client, limit) => {
    return await client.callTool({
      name: input.toolName,
      arguments: input.toolArgs ?? {},
    }, undefined, { timeout: limit });
  });
}

function isStringRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
