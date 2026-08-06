import { Elysia } from 'elysia';
import type { UnifiedRuntime } from '../../plugins/unified-loader.ts';
import type { UnifiedRuntimeRef } from '../../plugins/runtime-routes.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { mcpToolByName, toMcpToolDefinition, type RuntimeMcpToolManifest } from '../../tools/mcp-manifest.ts';
import { mcpRestMap, type McpRestMapEntry } from '../../tools/mcp-rest-map.ts';
import { getEnabledToolNames, loadToolGroupConfig } from '../../config/tool-groups-core.ts';

type PluginTool = UnifiedRuntime['mcpTools'][number];
type PluginToolSource = PluginTool[] | (() => PluginTool[]);
type McpRouteOptions = PluginToolSource | {
  pluginTools?: PluginToolSource;
  runtimeRef?: UnifiedRuntimeRef<Pick<UnifiedRuntime, 'mcpTools'>>;
  /**
   * Which tools the running config serves. Injectable because `loadToolGroupConfig()`
   * resolves `ORACLE_DATA_DIR` as a module constant read at import time, so a test cannot
   * redirect it with an env var after the fact — the same trap #2837 fixed by threading
   * `dataDir` through explicitly.
   */
  servedToolNames?: () => Iterable<string>;
};

type PublicTool = ReturnType<typeof toMcpToolDefinition> & {
  group?: string;
  readOnly?: boolean;
  /**
   * The tool's own manifest default — NOT whether it is currently served.
   *
   * These are easy to confuse, and the difference was large: with the tool-groups config on
   * this machine, 32 tools were listed here while an MCP client was offered 2. Read `served`
   * for the live answer.
   */
  enabledByDefault?: boolean;
  /** Whether the running tool-groups config actually serves this tool right now. */
  served?: boolean;
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
    const listed = [...coreTools, ...currentPluginTools(options).filter(isValidPluginTool).map(pluginTool)];

    // This endpoint is a catalogue: it lists every tool that EXISTS, which is what the
    // /tools/config surface needs in order to offer a disabled tool for enabling. It said
    // nothing about which are actually served, so a reader could not tell the catalogue from
    // the offer — 32 listed here against 2 reachable over MCP, with no field expressing the
    // gap. Same declared-but-not-true shape as #2822 and #2870.
    //
    // Filtering the list would break /tools/config. Marking each entry does not.
    const resolveServed = !Array.isArray(options) && typeof options === 'object' && options.servedToolNames
      ? options.servedToolNames
      : () => getEnabledToolNames(loadToolGroupConfig());
    const servedNames = new Set(resolveServed());
    const tools = listed.map((tool) => ({ ...tool, served: servedNames.has(tool.name) }));
    const tenantId = currentTenantId();
    return {
      tools,
      total: tools.length,
      served: tools.filter((tool) => tool.served).length,
      ...(tenantId ? { tenant: { id: tenantId, scope: 'tenant_id' } } : {}),
    };
  }, {
    detail: {
      tags: ['mcp'],
      menu: { group: 'hidden' },
      summary: 'List MCP tool definitions for frontend browsers',
    },
  });
}
