import type { McpTool } from '../types';

export function groupLabel(tool: McpTool): string {
  return tool.group || (tool.plugin ? `plugin:${tool.plugin}` : 'mcp');
}

export function toolMode(tool: McpTool): string {
  if (tool.readOnly === true) return 'read-only';
  if (tool.readOnly === false) return 'write';
  return 'unspecified';
}

export function schemaText(tool: McpTool): string {
  return JSON.stringify(tool.inputSchema ?? {}, null, 2);
}
