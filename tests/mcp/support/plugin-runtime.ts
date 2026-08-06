import type { UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';

export function runtimeReturning(result: unknown, tool: Record<string, unknown> = {}): UnifiedRuntime {
  return {
    routes: [],
    mcpTools: [{ plugin: 'demo', name: 'demo_tool', handler: 'run', description: 'Demo', inputSchema: { type: 'object' }, ...tool } as any],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => result,
    pluginStatuses: () => [],
    init: async () => {},
    stop: async () => {},
  } as UnifiedRuntime;
}
