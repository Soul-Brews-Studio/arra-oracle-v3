import { Elysia } from 'elysia';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';
import type { UnifiedRuntimeRef } from '../../plugins/runtime-routes.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { mcpToolByName, toMcpToolDefinition, type RuntimeMcpToolManifest } from '../../tools/mcp-manifest.ts';
import { mcpRestMap, type McpRestMapEntry } from '../../tools/mcp-rest-map.ts';

type PluginTool = UnifiedRuntime['mcpTools'][number];
type PluginToolSource = PluginTool[] | (() => PluginTool[]);
type McpRouteOptions = PluginToolSource | {
  pluginTools?: PluginToolSource;
  runtimeRef?: UnifiedRuntimeRef<Pick<UnifiedRuntime, 'mcpTools'>>;
};

type PublicTool = ReturnType<typeof toMcpToolDefinition> & {
  group?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  remoteable?: boolean;
  rest?: { method: string; path: string };
  localOnlyReason?: string;
  source: 'core' | 'plugin';
  plugin?: string;
};

function coreTool(entry: McpRestMapEntry): PublicTool | null {
  const tool = mcpToolByName.get(entry.name);
  if (!tool) return null;
  return {
    ...toMcpToolDefinition(tool),
    group: tool.group,
    readOnly: tool.readOnly,
    enabledByDefault: tool.enabledByDefault,
    remoteable: entry.remoteable,
    ...(entry.remoteable ? { rest: { method: entry.method, path: entry.path } } : { localOnlyReason: entry.reason }),
    source: 'core',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidPluginTool(tool: PluginTool): boolean {
  return typeof tool.name === 'string' && tool.name.length > 0
    && typeof tool.description === 'string' && tool.description.length > 0
    && isRecord(tool.inputSchema)
    && typeof tool.plugin === 'string' && tool.plugin.length > 0;
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

function readPluginTools(source: PluginToolSource | undefined): PluginTool[] {
  return typeof source === 'function' ? source() : source ?? [];
}

function currentPluginTools(options: McpRouteOptions): PluginTool[] {
  if (Array.isArray(options) || typeof options === 'function') return readPluginTools(options);
  return options.runtimeRef?.current.mcpTools ?? readPluginTools(options.pluginTools);
}

export function createMcpRoutes(options: McpRouteOptions = []) {
  return new Elysia({ prefix: '/api' }).get('/mcp/tools', () => {
    const coreTools = mcpRestMap.map(coreTool).filter((tool): tool is PublicTool => !!tool);
    const tools = [...coreTools, ...currentPluginTools(options).filter(isValidPluginTool).map(pluginTool)];
    const tenantId = currentTenantId();
    return { tools, total: tools.length, ...(tenantId ? { tenant: { id: tenantId, scope: 'tenant_id' } } : {}) };
  }, {
    detail: {
      tags: ['mcp'],
      menu: { group: 'hidden' },
      summary: 'List MCP tool definitions for frontend browsers',
    },
  });
}
