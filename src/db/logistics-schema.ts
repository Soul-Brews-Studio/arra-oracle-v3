import { sqliteTable, text, integer, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// ============================================================================
// Supersede Log (Issue #18) - Audit trail for "Nothing is Deleted"
// ============================================================================

// Tracks document supersessions even when original file is deleted.
// Separate from oracle_documents.superseded_by to preserve history.
export const supersedeLog = sqliteTable('supersede_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  oldPath: text('old_path').notNull(),
  oldId: text('old_id'),
  oldTitle: text('old_title'),
  oldType: text('old_type'),
  newPath: text('new_path'),
  newId: text('new_id'),
  newTitle: text('new_title'),
  reason: text('reason'),
  supersededAt: integer('superseded_at').notNull(),
  supersededBy: text('superseded_by'),
  project: text('project'),
}, (table) => [
  index('idx_supersede_old_path').on(table.oldPath),
  index('idx_supersede_new_path').on(table.newPath),
  index('idx_supersede_created').on(table.supersededAt),
  index('idx_supersede_project').on(table.project),
]);

// ============================================================================
// Activity Log - User activity tracking
// ============================================================================

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  timestamp: text('timestamp').notNull(),
  type: text('type').notNull(),
  path: text('path'),
  sizeBytes: integer('size_bytes'),
  project: text('project'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: text('created_at'),
}, (table) => [
  index('idx_activity_date').on(table.date),
  index('idx_activity_type').on(table.type),
  index('idx_activity_project').on(table.project),
]);

// ============================================================================
// Schedule Table - Appointments & events (per-human, shared across Oracles)
// ============================================================================

export const schedule = sqliteTable('schedule', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  dateRaw: text('date_raw'),
  time: text('time'),
  event: text('event').notNull(),
  notes: text('notes'),
  recurring: text('recurring'),
  status: text('status').default('pending'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('idx_schedule_date').on(table.date),
  index('idx_schedule_status').on(table.status),
]);

// ============================================================================
// Settings Table - Key-value store for configuration
// ============================================================================

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at').notNull(),
});

// ============================================================================
// Menu Items Table — studio navigation, seeded from route detail.menu metadata
// ============================================================================

export const menuItems = sqliteTable('menu_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull(),
  label: text('label').notNull(),
  groupKey: text('group_key').notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => menuItems.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(999),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  access: text('access').notNull().default('public'),
  source: text('source').notNull(),
  icon: text('icon'),
  host: text('host'),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  scope: text('scope').notNull().default('main'),
  query: text('query'),
  studio: text('studio'),
  touchedAt: integer('touched_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_menu_parent').on(table.parentId, table.position),
  index('idx_menu_group').on(table.groupKey, table.position),
  index('idx_menu_deleted_at').on(table.deletedAt),
  index('idx_menu_path_studio').on(table.path, table.studio),
]);
