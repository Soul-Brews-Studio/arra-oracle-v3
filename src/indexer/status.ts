/**
 * Indexing status updates for tray app
 */

import { eq, sql } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { indexingStatus } from '../db/schema.ts';
import type { IndexerConfig } from '../types.ts';

/**
 * Update indexing status for tray app
 */
export function setIndexingStatus(
  input: OracleDbInput,
  config: IndexerConfig,
  isIndexing: boolean,
  current: number = 0,
  total: number = 0,
  error?: string
): void {
  const db = asOracleDb(input);
  // Ensure repo_root column exists (migration)
  try {
    db.run(sql`ALTER TABLE indexing_status ADD COLUMN repo_root TEXT`);
  } catch {
    // Column already exists
  }

  const now = Date.now();
  db.update(indexingStatus)
    .set({
      isIndexing: isIndexing ? 1 : 0,
      progressCurrent: current,
      progressTotal: total,
      startedAt: isIndexing ? sql`coalesce(${indexingStatus.startedAt}, ${now})` : sql`${indexingStatus.startedAt}`,
      completedAt: isIndexing ? null : now,
      error: error || null,
      repoRoot: config.repoRoot,
    })
    .where(eq(indexingStatus.id, 1))
    .run();
}
