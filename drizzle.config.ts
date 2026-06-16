import { defineConfig } from 'drizzle-kit';
import path from 'path';

// Default to ~/.oracle/oracle.db (same as server)
const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR ||
  path.join(process.env.HOME || '/tmp', '.oracle');
const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, 'oracle.db');

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', './src/db/export-schema.ts', './src/storage/audit-log.ts'],
  out: './src/db/migrations',
  dbCredentials: {
    url: DB_PATH,
  },
  // Tables managed by Drizzle (excludes FTS5 internal tables)
  tablesFilter: [
    'oracle_documents',
    'oracle_memories',
    'indexing_status',
    'search_log',
    'consult_log',
    'learn_log',
    'document_access',
    'forum_threads',
    'forum_messages',
    'decisions',
    'trace_log',      // Issue #17
    'supersede_log',  // Issue #18
    'activity_log',   // User activity tracking
    'settings',       // Auth & app settings
    'schedule',       // Appointments & events
    'menu_items',     // Studio navigation (seeded from route detail.menu)
    'audit_log',      // Query write audit trail
    'export_jobs',    // Export run history
  ],
});
