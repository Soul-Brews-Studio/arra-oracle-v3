import { Elysia } from 'elysia';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';
import { mcpTools, toMcpToolDefinition, type RuntimeMcpToolManifest } from '../../tools/mcp-manifest.ts';

type PluginTool = UnifiedRuntime['mcpTools'][number];

type PublicTool = ReturnType<typeof toMcpToolDefinition> & {
  group?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  source: 'core' | 'plugin';
  plugin?: string;
};

function coreTool(tool: RuntimeMcpToolManifest): PublicTool {
  return {
    ...toMcpToolDefinition(tool),
    group: tool.group,
    readOnly: tool.readOnly,
    enabledByDefault: tool.enabledByDefault,
    source: 'core',
  };
}

function pluginTool(tool: PluginTool): PublicTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    group: tool.group ?? `plugin:${tool.plugin}`,
    readOnly: tool.readOnly,
    enabledByDefault: tool.enabledByDefault,
    source: 'plugin',
    plugin: tool.plugin,
  };
}

export function createMcpRoutes(pluginTools: PluginTool[] = []) {
  return new Elysia({ prefix: '/api' }).get('/mcp/tools', () => {
    const tools = [...mcpTools.map(coreTool), ...pluginTools.map(pluginTool)];
    return { tools, total: tools.length };
  }, {
    detail: {
      tags: ['mcp'],
      menu: { group: 'hidden' },
      summary: 'List MCP tool definitions for frontend browsers',
    },
  });
}
