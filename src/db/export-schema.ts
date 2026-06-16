import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const exportJobs = sqliteTable('export_jobs', {
  id: text('id').primaryKey(),
  collection: text('collection').notNull(),
  format: text('format').notNull(),
  timestamp: integer('timestamp').notNull(),
  status: text('status').notNull(),
}, (table) => [
  index('idx_export_jobs_timestamp').on(table.timestamp),
]);
