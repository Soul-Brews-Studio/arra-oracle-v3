import type { UnifiedMcpToolManifest } from '../plugins/unified-manifest.ts';
import { GUIDE_TOOL_NAME, guideToolDefinition, guideToolResponse } from '../mcp/guide.ts';
import type { ToolContext, ToolResponse } from './types.ts';
import { recapToolDef, handleRecap } from './recap.ts';
import { chainSearchToolDef, handleChainSearch } from './chain-search.ts';
import { searchToolDef, handleSearch } from './search.ts';
import { readToolDef, handleRead } from './read.ts';
import { learnToolDef, handleLearn } from './learn.ts';
import { listToolDef, handleList } from './list.ts';
import { statsToolDef, handleStats } from './stats.ts';
import { conceptsToolDef, handleConcepts } from './concepts.ts';
import { supersedeToolDef, handleSupersede } from './supersede.ts';
import { handoffToolDef, handleHandoff } from './handoff.ts';
import { inboxToolDef, handleInbox } from './inbox.ts';
import { forumToolDefs, handleThread, handleThreads, handleThreadRead, handleThreadUpdate } from './forum.ts';
import { traceToolDefs, handleTrace, handleTraceList, handleTraceGet, handleTraceLink, handleTraceUnlink, handleTraceChain } from './trace.ts';
import {
  oracleProfileToolDef,
  oracleTraceDistillToolDef,
  oracleResearchNoteToolDef,
  handleOracleProfile,
  handleOracleTraceDistill,
  handleOracleResearchNote,
} from './oracle.ts';
import { reflectToolDef, handleReflect } from './reflect.ts';
import { verifyToolDef, handleVerify } from './verify.ts';
import { mcpCallToolDef, mcpListToolsToolDef, handleMcpCall, handleMcpListTools } from './mcp-in.ts';
type Runtime = { version: string; getToolCtx: () => Promise<ToolContext> };
export type RuntimeMcpHandler = (input: unknown, runtime: Runtime) => Promise<ToolResponse> | ToolResponse;
export interface RuntimeMcpToolManifest extends Omit<UnifiedMcpToolManifest, 'handler'> {
  handler: RuntimeMcpHandler;
  handlerId: string;
}

type ToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

function ctxTool<I>(def: ToolDef, group: string, readOnly: boolean, handlerId: string,
  fn: (ctx: ToolContext, input: I) => Promise<ToolResponse>): RuntimeMcpToolManifest {
  return { ...def, group, readOnly, enabledByDefault: true, handlerId, handler: async (input, runtime) => fn(await runtime.getToolCtx(), input as I) };
}

function noCtxTool<I>(def: ToolDef, group: string, readOnly: boolean, handlerId: string,
  fn: (input: I) => Promise<ToolResponse> | ToolResponse): RuntimeMcpToolManifest {
  return { ...def, group, readOnly, enabledByDefault: true, handlerId, handler: (input) => fn(input as I) };
}

const forumHandlers: Array<(input: unknown) => Promise<ToolResponse>> = [handleThread, handleThreads, handleThreadRead, handleThreadUpdate] as Array<(input: unknown) => Promise<ToolResponse>>;
const traceHandlers: Array<(input: unknown) => Promise<ToolResponse>> = [handleTrace, handleTraceList, handleTraceGet, handleTraceLink, handleTraceUnlink, handleTraceChain] as Array<(input: unknown) => Promise<ToolResponse>>;
const traceReadOnly = [false, true, true, false, false, true];

export const mcpTools: RuntimeMcpToolManifest[] = [
  { ...guideToolDefinition(), group: 'guide', readOnly: true, enabledByDefault: true, handlerId: 'guide', handler: (_input, runtime) => guideToolResponse(runtime.version) },
  ctxTool(recapToolDef, 'oracle', true, 'handleRecap', handleRecap),
  ctxTool(searchToolDef, 'search', true, 'handleSearch', handleSearch),
  ctxTool(chainSearchToolDef, 'search', false, 'handleChainSearch', handleChainSearch),
  ctxTool(readToolDef, 'search', true, 'handleRead', handleRead),
  ctxTool(learnToolDef, 'knowledge', false, 'handleLearn', handleLearn),
  ctxTool(listToolDef, 'search', true, 'handleList', handleList),
  ctxTool(statsToolDef, 'knowledge', true, 'handleStats', handleStats),
  ctxTool(conceptsToolDef, 'search', true, 'handleConcepts', handleConcepts),
  ctxTool(supersedeToolDef, 'knowledge', false, 'handleSupersede', handleSupersede),
  ctxTool(oracleResearchNoteToolDef, 'knowledge', false, 'handleOracleResearchNote', handleOracleResearchNote),
  ctxTool(handoffToolDef, 'session', false, 'handleHandoff', handleHandoff),
  ctxTool(inboxToolDef, 'session', true, 'handleInbox', handleInbox),
  ...forumToolDefs.map((def, index) => noCtxTool(def, 'forum', index !== 0 && index !== 3, forumHandlers[index].name, forumHandlers[index])),
  noCtxTool(oracleProfileToolDef, 'oracle', true, 'handleOracleProfile', handleOracleProfile),
  ...traceToolDefs.map((def, index) => noCtxTool(def, index === 0 ? 'trace' : 'dig', traceReadOnly[index], traceHandlers[index].name, traceHandlers[index])),
  noCtxTool(oracleTraceDistillToolDef, 'trace', false, 'handleOracleTraceDistill', handleOracleTraceDistill),
  ctxTool(reflectToolDef, 'standalone', true, 'handleReflect', handleReflect),
  ctxTool(verifyToolDef, 'standalone', false, 'handleVerify', handleVerify),
  noCtxTool(mcpListToolsToolDef, 'mcp', true, 'handleMcpListTools', handleMcpListTools),
  noCtxTool(mcpCallToolDef, 'mcp', false, 'handleMcpCall', handleMcpCall),
];

export const mcpToolByName = new Map(mcpTools.map((tool) => [tool.name, tool]));

export function toMcpToolDefinition(tool: RuntimeMcpToolManifest) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

export function defaultMcpToolOrder(configOrder: string[]): string[] {
  const seen = new Set<string>();
  return [GUIDE_TOOL_NAME, ...configOrder, ...mcpTools.filter((t) => t.group === 'mcp' && t.enabledByDefault !== false).map((t) => t.name)]
    .filter((name) => mcpToolByName.has(name) && !seen.has(name) && seen.add(name));
}
