import { loadToolGroupConfig, type ToolGroupConfig } from '../config/tool-groups.ts';
import type { UnifiedRuntime } from '../plugins/unified-loader.ts';
import { remoteableMcpRestMap } from '../tools/mcp-rest-map.ts';

const REMOTEABLE_TOOL_NAMES = new Set(remoteableMcpRestMap.map((entry) => entry.name));
export const remoteableMcpToolNames = [...REMOTEABLE_TOOL_NAMES];

export function remoteHttpToolGroups(base: ToolGroupConfig = loadToolGroupConfig()): ToolGroupConfig {
  return {
    ...base,
    enabled_tools: base.enabled_tools?.filter((name) => REMOTEABLE_TOOL_NAMES.has(name)),
  };
}

export function emptyHttpPluginRuntime(): UnifiedRuntime {
  return {
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => { throw new Error('Plugin MCP tools are not exposed over Streamable HTTP'); },
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
  };
}
