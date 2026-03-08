/**
 * Shared types for Oracle tool handlers
 */

import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import type * as schema from '../db/schema.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';

/**
 * Context object passed to all tool handlers.
 * Replaces `this` references from the old class methods.
 */
export interface ToolContext {
  db: BunSQLiteDatabase<typeof schema>;
  sqlite: Database;
  repoRoot: string;
  vectorStore: VectorStoreAdapter;
  vectorStatus: 'unknown' | 'connected' | 'unavailable';
  version: string;
}

export interface ToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// ============================================================================
// Input interfaces (moved from index.ts)
// ============================================================================

export interface OracleSearchInput {
  query: string;
  type?: 'principle' | 'pattern' | 'learning' | 'retro' | 'all';
  limit?: number;
  offset?: number;
  mode?: 'hybrid' | 'fts' | 'vector';
  project?: string;
  cwd?: string;
  model?: 'nomic' | 'qwen3' | 'bge-m3';
}

export interface OracleReflectInput {}

export interface OracleLearnInput {
  pattern: string;
  source?: string;
  concepts?: string[];
  project?: string;
}

export interface OracleListInput {
  type?: 'principle' | 'pattern' | 'learning' | 'retro' | 'all';
  limit?: number;
  offset?: number;
}

export interface OracleStatsInput {}

export interface OracleConceptsInput {
  limit?: number;
  type?: 'principle' | 'pattern' | 'learning' | 'retro' | 'all';
}

export interface OracleSupersededInput {
  oldId: string;
  newId: string;
  reason?: string;
}

export interface OracleHandoffInput {
  content: string;
  slug?: string;
}

export interface OracleInboxInput {
  limit?: number;
  offset?: number;
  type?: 'handoff' | 'all';
}

export interface OracleVerifyInput {
  check?: boolean;
  type?: string;
}

export interface OracleScheduleAddInput {
  date: string;
  event: string;
  time?: string;
  notes?: string;
  recurring?: 'daily' | 'weekly' | 'monthly';
}

export interface OracleScheduleListInput {
  date?: string;
  from?: string;
  to?: string;
  filter?: string;
  status?: 'pending' | 'done' | 'cancelled' | 'all';
  limit?: number;
}

export interface OracleReadInput {
  file?: string;
  id?: string;
}
