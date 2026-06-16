/**
 * Arra Oracle v3 Database Schema (Drizzle ORM)
 *
 * Generated from existing database via drizzle-kit pull,
 * then cleaned up to exclude FTS5 internal tables.
 */

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name'),
  status: text('status').default('active').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('idx_tenants_status').on(table.status)]);
export const oracleDocuments = sqliteTable('oracle_documents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').default('default').notNull(),
  type: text('type').notNull(),
  sourceFile: text('source_file').notNull(),
  concepts: text('concepts').notNull(), // JSON array
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  indexedAt: integer('indexed_at').notNull(),
  // Supersede pattern (Issue #19) - "Nothing is Deleted" but can be outdated
  supersededBy: text('superseded_by'),      // ID of newer document
  supersededAt: integer('superseded_at'),   // When it was superseded
  supersededReason: text('superseded_reason'), // Why (optional)
  // Provenance tracking (Issue #22)
  origin: text('origin'),                   // 'mother' | 'arthur' | 'volt' | 'human' | null (legacy)
  project: text('project'),                 // ghq-style: 'github.com/laris-co/arra-oracle'
  createdBy: text('created_by'),            // 'indexer' | 'oracle_learn' | 'manual'
}, (table) => [
  index('idx_source').on(table.sourceFile),
  index('idx_type').on(table.type),
  index('idx_superseded').on(table.supersededBy),
  index('idx_origin').on(table.origin),
  index('idx_project').on(table.project),
  index('idx_documents_tenant').on(table.tenantId),
  index('idx_documents_tenant_type_active_updated').on(table.tenantId, table.type, table.supersededAt, table.updatedAt),
]);
// Challenge 2 memory system persistence (#1457)
export const oracleMemories = sqliteTable('oracle_memories', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  title: text('title'),
  tags: text('tags').default('[]').notNull(),
  source: text('source'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_memory_created').on(table.createdAt),
  index('idx_memory_title').on(table.title),
  index('idx_memory_source').on(table.source),
]);

// Indexing status tracking
export const indexingStatus = sqliteTable('indexing_status', {
  id: integer('id').primaryKey(),
  isIndexing: integer('is_indexing').default(0).notNull(),
  progressCurrent: integer('progress_current').default(0),
  progressTotal: integer('progress_total').default(0),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  error: text('error'),
  repoRoot: text('repo_root'),  // Root directory being indexed
});

// Per-doc per-model index job queue.
// Foundation for the indexer-CLI / FTS-first / vector-later split — a doc gets
// FTS5-inserted synchronously, then one row per registered model lands here for
// the daemon to embed asynchronously. Plug-and-play: adding/removing a model
// adds/skips queue entries without touching oracle_documents or other models'
// LanceDB collections. Design: ψ/lab/indexer-cli/DESIGN.md (M1).
export const indexingJobs = sqliteTable('indexing_jobs', {
  id: text('id').primaryKey(),                                  // "idx-<ts>-<modelKey>-<rand>"
  docId: text('doc_id').notNull(),                              // FK to oracle_documents.id
  modelKey: text('model_key').notNull(),                        // "bge-m3", "qwen3", ...
  collection: text('collection').notNull(),                     // "oracle_knowledge_bge_m3"
  status: text('status').default('pending').notNull(),          // pending | claimed | done | error
  attempts: integer('attempts').default(0).notNull(),
  createdAt: integer('created_at')
    .default(sql`(strftime('%s','now')*1000)`)
    .notNull(),
  claimedAt: integer('claimed_at'),
  finishedAt: integer('finished_at'),
  error: text('error'),
});

// Search query logging
export const searchLog = sqliteTable('search_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  query: text('query').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  type: text('type'),
  mode: text('mode'),
  resultsCount: integer('results_count'),
  searchTimeMs: integer('search_time_ms'),
  createdAt: integer('created_at').notNull(),
  project: text('project'),
  results: text('results'), // JSON array of top 5 results (id, type, score, snippet)
}, (table) => [
  index('idx_search_project').on(table.project),
  index('idx_search_tenant').on(table.tenantId),
  index('idx_search_created').on(table.createdAt),
  index('idx_search_tenant_created').on(table.tenantId, table.createdAt),
]);

// Consult log — legacy table kept for backward compat (pre-0007 snapshot had it).
// Not actively used; retained to avoid destructive migration drop.
export const consultLog = sqliteTable('consult_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  decision: text('decision').notNull(),
  context: text('context'),
  principlesFound: integer('principles_found').notNull(),
  patternsFound: integer('patterns_found').notNull(),
  guidance: text('guidance').notNull(),
  createdAt: integer('created_at').notNull(),
  project: text('project'),
}, (table) => [
  index('idx_consult_project').on(table.project),
  index('idx_consult_created').on(table.createdAt),
]);

// Learning/pattern logging
export const learnLog = sqliteTable('learn_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: text('document_id').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  patternPreview: text('pattern_preview'),
  source: text('source'),
  concepts: text('concepts'), // JSON array
  createdAt: integer('created_at').notNull(),
  project: text('project'),
}, (table) => [
  index('idx_learn_project').on(table.project),
  index('idx_learn_tenant').on(table.tenantId),
  index('idx_learn_created').on(table.createdAt),
]);

// Document access logging
export const documentAccess = sqliteTable('document_access', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  documentId: text('document_id').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  accessType: text('access_type'),
  createdAt: integer('created_at').notNull(),
  project: text('project'),
}, (table) => [
  index('idx_access_project').on(table.project),
  index('idx_access_tenant').on(table.tenantId),
  index('idx_access_created').on(table.createdAt),
  index('idx_access_doc').on(table.documentId),
]);


export const forumThreads = sqliteTable('forum_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  createdBy: text('created_by').default('human'),
  status: text('status').default('active'), // active, answered, pending, closed
  issueUrl: text('issue_url'),              // GitHub mirror URL
  issueNumber: integer('issue_number'),
  project: text('project'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  syncedAt: integer('synced_at'),
}, (table) => [
  index('idx_thread_status').on(table.status),
  index('idx_thread_project').on(table.project),
  index('idx_thread_tenant').on(table.tenantId),
  index('idx_thread_created').on(table.createdAt),
  index('idx_thread_tenant_status_updated').on(table.tenantId, table.status, table.updatedAt),
]);

export const forumMessages = sqliteTable('forum_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull().references(() => forumThreads.id),
  role: text('role').notNull(),             // human, oracle, claude
  content: text('content').notNull(),
  author: text('author'),                   // GitHub username or "oracle"
  principlesFound: integer('principles_found'),
  patternsFound: integer('patterns_found'),
  searchQuery: text('search_query'),
  commentId: integer('comment_id'),         // GitHub comment ID if synced
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_message_thread').on(table.threadId),
  index('idx_message_role').on(table.role),
  index('idx_message_created').on(table.createdAt),
]);
// Note: FTS5 virtual table (oracle_fts) is managed via raw SQL
// since Drizzle doesn't natively support FTS5
// Trace Log Tables (discovery tracing with dig points)

export const traceLog = sqliteTable('trace_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  traceId: text('trace_id').unique().notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  query: text('query').notNull(),
  queryType: text('query_type').default('general'),  // general, project, pattern, evolution

  foundFiles: text('found_files'),            // [{path, type, matchReason, confidence}]
  foundCommits: text('found_commits'),        // [{hash, shortHash, date, message}]
  foundIssues: text('found_issues'),          // [{number, title, state, url}]
  foundRetrospectives: text('found_retrospectives'),  // [paths]
  foundLearnings: text('found_learnings'),    // [paths]
  foundResonance: text('found_resonance'),    // [paths]

  fileCount: integer('file_count').default(0),
  commitCount: integer('commit_count').default(0),
  issueCount: integer('issue_count').default(0),

  depth: integer('depth').default(0),         // 0 = initial, 1+ = dig from parent
  parentTraceId: text('parent_trace_id'),     // Links to parent trace
  childTraceIds: text('child_trace_ids').default('[]'),  // Links to child traces

  prevTraceId: text('prev_trace_id'),         // ← Previous trace in chain
  nextTraceId: text('next_trace_id'),         // → Next trace in chain

  project: text('project'),                   // ghq format project path
  scope: text('scope').default('project'),    // 'project' | 'cross-project' | 'human'
  sessionId: text('session_id'),              // Claude session if available
  agentCount: integer('agent_count').default(1),
  durationMs: integer('duration_ms'),

  status: text('status').default('raw'),      // raw, reviewed, distilling, distilled
  awakening: text('awakening'),               // Extracted insight (markdown)
  distilledToId: text('distilled_to_id'),     // Learning ID if promoted
  distilledAt: integer('distilled_at'),

  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_trace_query').on(table.query),
  index('idx_trace_project').on(table.project),
  index('idx_trace_tenant').on(table.tenantId),
  index('idx_trace_status').on(table.status),
  index('idx_trace_parent').on(table.parentTraceId),
  index('idx_trace_prev').on(table.prevTraceId),
  index('idx_trace_next').on(table.nextTraceId),
  index('idx_trace_created').on(table.createdAt),
]);

export { activityLog, menuItems, schedule, settings, supersedeLog } from './logistics-schema.ts';
