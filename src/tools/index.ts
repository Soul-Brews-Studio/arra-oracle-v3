/**
 * Oracle Tools — Barrel Export
 *
 * All tool definitions and handlers in one place.
 */

// Types
export type { ToolContext, ToolResponse } from './types.ts';
export type {
  OracleSearchInput,
  OracleLearnInput,
  OracleListInput,
  OracleStatsInput,
  OracleConceptsInput,
  OracleSupersededInput,
  OracleHandoffInput,
  OracleInboxInput,
  OracleReadInput,
} from './types.ts';

// Search (+ pure helpers)
export {
  searchToolDef,
  handleSearch,
  sanitizeFtsQuery,
  normalizeFtsScore,
  parseConceptsFromMetadata,
  combineResults,
  vectorSearch,
} from './search.ts';

// Learn (+ pure helpers)
export {
  learnToolDef,
  handleLearn,
  normalizeProject,
  extractProjectFromSource,
} from './learn.ts';

// List
export { listToolDef, handleList } from './list.ts';

// Stats
export { statsToolDef, handleStats } from './stats.ts';

// Concepts
export { conceptsToolDef, handleConcepts } from './concepts.ts';

// Supersede
export { supersedeToolDef, handleSupersede } from './supersede.ts';

// Handoff
export { handoffToolDef, handleHandoff } from './handoff.ts';

// Inbox
export { inboxToolDef, handleInbox } from './inbox.ts';

// Read
export { readToolDef, handleRead } from './read.ts';

// Forum
export type {
  OracleThreadInput,
  OracleThreadsInput,
  OracleThreadReadInput,
  OracleThreadUpdateInput,
} from './forum.ts';
export {
  forumToolDefs,
  handleThread,
  handleThreads,
  handleThreadRead,
  handleThreadUpdate,
} from './forum.ts';

// Trace
export {
  traceToolDefs,
  handleTrace,
  handleTraceList,
  handleTraceGet,
  handleTraceLink,
  handleTraceUnlink,
  handleTraceChain,
} from './trace.ts';

// Standalone tools (closes #972 — handlers existed in-source but weren't wired
// into the MCP dispatch. Same handlers ALSO power HTTP routes /api/reflect,
// /api/verify, so they're battle-tested by HTTP consumers).
//
// NOTE: schedule_add / schedule_list are NOT wired as MCP tools per maintainer
// direction — they remain HTTP-only at /api/schedule/*. Their exports stay in
// place for the HTTP route consumers (src/routes/schedule/*.ts).
export type {
  OracleReflectInput,
  OracleVerifyInput,
} from './types.ts';
export { reflectToolDef, handleReflect } from './reflect.ts';
export { verifyToolDef, handleVerify } from './verify.ts';

// MCP-IN bridge tools: consume tools from external stdio MCP servers.
export type { OracleMcpServerInput, OracleMcpCallInput } from './mcp-in.ts';
export { mcpListToolsToolDef, mcpCallToolDef, handleMcpListTools, handleMcpCall } from './mcp-in.ts';

// Unified runtime manifest for MCP-out registration.
export type { RuntimeMcpToolManifest, RuntimeMcpHandler } from './mcp-manifest.ts';
export { mcpTools, mcpToolByName, defaultMcpToolOrder, toMcpToolDefinition } from './mcp-manifest.ts';
