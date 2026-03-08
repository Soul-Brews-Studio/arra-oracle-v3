/**
 * Oracle Tools — Barrel Export
 *
 * All tool definitions and handlers in one place.
 */

// Types
export type { ToolContext, ToolResponse } from './types.ts';
export type {
  OracleSearchInput,
  OracleReflectInput,
  OracleLearnInput,
  OracleListInput,
  OracleStatsInput,
  OracleConceptsInput,
  OracleSupersededInput,
  OracleHandoffInput,
  OracleInboxInput,
  OracleVerifyInput,
  OracleScheduleAddInput,
  OracleScheduleListInput,
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

// Reflect
export { reflectToolDef, handleReflect } from './reflect.ts';

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

// Verify (bridge to verify/handler.ts)
export { verifyToolDef, handleVerify } from './verify.ts';

// Schedule
export { scheduleAddToolDef, handleScheduleAdd, scheduleListToolDef, handleScheduleList, parseDate, formatTempoLabel } from './schedule.ts';

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

