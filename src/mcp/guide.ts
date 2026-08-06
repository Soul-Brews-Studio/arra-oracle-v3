import type { ToolResponse } from '../tools/types.ts';

export const GUIDE_TOOL_NAME = '____IMPORTANT';

export function guideToolDefinition() {
  return {
    name: GUIDE_TOOL_NAME,
    description: 'ORACLE WORKFLOW GUIDE: search, learn, trace, handoff, and MCP bridge tools.',
    inputSchema: { type: 'object', properties: {} },
  };
}

export function guideToolResponse(version: string): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: `ORACLE WORKFLOW GUIDE (v${version})\n\n` +
        `1. SEARCH & DISCOVER\n   oracle_search(query, retrieval="compact-summary") → token-light keyword/vector search\n` +
        `   oracle_read(file/id) → full document\n   oracle_list() → browse all\n` +
        `   oracle_concepts() → topic coverage\n\n` +
        `2. LEARN & REMEMBER\n   oracle_learn(pattern) → add a learning\n` +
        `   oracle_thread(message) → start/continue a thread\n` +
        `   oracle_supersede(oldId, newId) → mark outdated\n\n` +
        `3. TRACE & DISTILL\n   oracle_trace(query) → log discovery\n` +
        `   oracle_trace_list/get/link/unlink/chain → inspect related traces\n\n` +
        `4. MCP BRIDGE\n   oracle_mcp_list_tools(command,args) → inspect an external MCP server\n` +
        `   oracle_mcp_call(command,args,toolName,toolArgs) → call one external tool\n\n` +
        `Philosophy: Nothing is Deleted — supersede, don't remove.`,
    }],
  };
}
