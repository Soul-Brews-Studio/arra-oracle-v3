/**
 * Forum tables — threads and their messages.
 *
 * Split out of `schema.ts` when that file hit the 250-line ceiling. It already follows this
 * pattern for `export-schema`, `fleet-log-schema`, `oracle-dig-schema`, `logistics-schema`
 * and `vector-schema`, so forum joins them rather than the file growing by one more line.
 *
 * Split rather than padded: the previous approach was to cram two `export {...}` statements
 * onto a single line to stay at exactly 250, which satisfies the counter without addressing
 * what it is counting.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const forumThreads = sqliteTable('forum_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  tenantId: text('tenant_id').default('default').notNull(),
  createdBy: text('created_by').default('human'),
  status: text('status').default('active'),
  issueUrl: text('issue_url'),
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
  role: text('role').notNull(),
  content: text('content').notNull(),
  author: text('author'),
  principlesFound: integer('principles_found'),
  patternsFound: integer('patterns_found'),
  searchQuery: text('search_query'),
  commentId: integer('comment_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_message_thread').on(table.threadId),
  index('idx_message_role').on(table.role),
  index('idx_message_created').on(table.createdAt),
]);
