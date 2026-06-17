import { callExternalMcpTool, listExternalMcpTools } from '../mcp/client.ts';
import type { ToolResponse } from './types.ts';

export interface OracleMcpServerInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface OracleMcpCallInput extends OracleMcpServerInput {
  toolName: string;
  toolArgs?: Record<string, unknown>;
}

const serverProperties = {
  command: { type: 'string', description: 'Command that starts the external MCP server, e.g. bun' },
  args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the server command' },
  cwd: { type: 'string', description: 'Optional working directory for the external server' },
  env: { type: 'object', description: 'Optional environment overrides for the external server' },
  timeoutMs: { type: 'integer', minimum: 1, maximum: 60000, description: 'Per-operation timeout in milliseconds' },
};

export const mcpListToolsToolDef = {
  name: 'oracle_mcp_list_tools',
  description: 'MCP-IN: start an external stdio MCP server and list its advertised tools.',
  inputSchema: {
    type: 'object',
    properties: serverProperties,
    required: ['command'],
  },
};

export const mcpCallToolDef = {
  name: 'oracle_mcp_call',
  description: 'MCP-IN: call one tool exposed by an external stdio MCP server.',
  inputSchema: {
    type: 'object',
    properties: {
      ...serverProperties,
      toolName: { type: 'string', description: 'External MCP tool name to call' },
      toolArgs: { type: 'object', description: 'Arguments for the external tool' },
    },
    required: ['command', 'toolName'],
  },
};

function jsonResponse(payload: unknown, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorResponse(error: unknown): ToolResponse {
  return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, true);
}

export async function handleMcpListTools(input: OracleMcpServerInput): Promise<ToolResponse> {
  try {
    const tools = await listExternalMcpTools(input);
    return jsonResponse({ tools, total: tools.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMcpCall(input: OracleMcpCallInput): Promise<ToolResponse> {
  try {
    const result = await callExternalMcpTool(input);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
