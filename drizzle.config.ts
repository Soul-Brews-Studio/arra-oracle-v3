import { defineConfig } from 'drizzle-kit';
import path from 'path';

// Default to ~/.oracle/oracle.db (same as server)
const ORACLE_DATA_DIR = process.env.ORACLE_DATA_DIR ||
  path.join(process.env.HOME || '/tmp', '.oracle');
const DB_PATH = process.env.ORACLE_DB_PATH || path.join(ORACLE_DATA_DIR, 'oracle.db');

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: DB_PATH,
  },
  // Tables managed by Drizzle (excludes FTS5 internal tables)
  tablesFilter: [
    'oracle_documents',
    'indexing_status',
    'indexing_jobs',  // Per-doc per-model index queue (M1 of indexer-CLI)
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
  ],
});
