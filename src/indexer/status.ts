/**
 * Indexing status updates for tray app
 */

import { Database } from 'bun:sqlite';
import type { IndexerConfig } from '../types.ts';

/**
 * Update indexing status for tray app
 */
export function setIndexingStatus(
  sqlite: Database,
  config: IndexerConfig,
  isIndexing: boolean,
  current: number = 0,
  total: number = 0,
  error?: string
): void {
  // Ensure repo_root column exists (migration)
  try {
    sqlite.exec('ALTER TABLE indexing_status ADD COLUMN repo_root TEXT');
  } catch {
    // Column already exists
  }

  sqlite.prepare(`
    UPDATE indexing_status SET
      is_indexing = ?,
      progress_current = ?,
      progress_total = ?,
      started_at = CASE WHEN ? = 1 AND started_at IS NULL THEN ? ELSE started_at END,
      completed_at = CASE WHEN ? = 0 THEN ? ELSE NULL END,
      error = ?,
      repo_root = ?
    WHERE id = 1
  `).run(
    isIndexing ? 1 : 0,
    current,
    total,
    isIndexing ? 1 : 0,
    Date.now(),
    isIndexing ? 1 : 0,
    Date.now(),
    error || null,
    config.repoRoot
  );
}
