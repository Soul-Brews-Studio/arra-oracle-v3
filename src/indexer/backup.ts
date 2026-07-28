/**
 * Database backup before destructive operations
 * Philosophy: "Nothing is Deleted" - always preserve data
 */

import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';
import type { IndexerConfig } from '../types.ts';

const DEFAULT_BACKUP_KEEP = 10;

/**
 * Stale lock threshold: if a lock file is older than this, assume the
 * owning process crashed and reclaim it.
 */
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Acquire an exclusive file lock using O_CREAT|O_EXCL (atomic on all OS).
 * Returns `true` if the lock was acquired, `false` if another process holds it.
 * Automatically removes stale locks from crashed processes.
 */
export function acquireLock(lockPath: string): boolean {
  // Check for stale lock first
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      console.warn(`⚠️ Removing stale backup lock (age: ${Math.round((Date.now() - stat.mtimeMs) / 1000)}s)`);
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Lock file doesn't exist — good, proceed to create it
  }

  try {
    const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    // Write our PID so stale-lock diagnostics can identify the owner
    fs.writeSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return true;
  } catch (e: any) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

/**
 * Release the file lock.
 */
export function releaseLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already removed — harmless
  }
}

/**
 * Delete old backup/export files, keeping the most recent `keep`.
 * Each family (.backup-, .export-*.json, .export-*.csv) is rotated
 * independently so a missing member doesn't skew retention.
 */
function rotateBackups(dbPath: string, keep: number): void {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const families: Array<{ prefix: string; suffix: string }> = [
    { prefix: `${base}.backup-`, suffix: '' },
    { prefix: `${base}.export-`, suffix: '.json' },
    { prefix: `${base}.export-`, suffix: '.csv' },
  ];

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    console.warn(`\u26a0\ufe0f Backup rotation: readdir failed: ${e instanceof Error ? e.message : e}`);
    return;
  }

  for (const { prefix, suffix } of families) {
    // Re-read directory for each family so we see files created by any
    // concurrent process that finished between families (belt-and-suspenders
    // with the file lock above).
    let freshEntries: string[];
    try {
      freshEntries = fs.readdirSync(dir);
    } catch {
      freshEntries = entries; // fall back to initial snapshot
    }

    const matches = freshEntries
      .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
      .sort()
      .reverse();
    for (const old of matches.slice(keep)) {
      try {
        fs.unlinkSync(path.join(dir, old));
        console.log(`\u{1f5d1}\ufe0f  Rotated old backup: ${old}`);
      } catch (e) {
        console.warn(`\u26a0\ufe0f Failed to delete ${old}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

/**
 * Backup database before destructive operations
 *
 * Creates:
 * 1. SQLite file backup (.backup-TIMESTAMP)
 * 2. JSON export (.export-TIMESTAMP.json) for portability
 * 3. CSV export (.export-TIMESTAMP.csv) for DuckDB/analytics
 */
export function backupDatabase(sqlite: Database, config: IndexerConfig): void {
  const lockPath = `${config.dbPath}.backup.lock`;

  if (!acquireLock(lockPath)) {
    console.log('⏳ Backup already in progress (locked by another process) — skipping');
    return;
  }

  try {
    backupDatabaseUnsafe(sqlite, config);
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Internal: performs backup + rotation without locking.
 * Always call via `backupDatabase()` which serialises concurrent callers.
 */
function backupDatabaseUnsafe(sqlite: Database, config: IndexerConfig): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${config.dbPath}.backup-${timestamp}`;
  const jsonPath = `${config.dbPath}.export-${timestamp}.json`;
  const csvPath = `${config.dbPath}.export-${timestamp}.csv`;

  // 1. Copy SQLite file. Checkpoint the WAL first so all in-flight writes
  //    are flushed to the main DB file — otherwise fs.copyFileSync produces
  //    an incomplete backup (we hit this on 2026-04-16: live DB had 591 FTS
  //    rows but the copied .db file only had 134 checkpointed).
  try {
    try {
      sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.warn(`\u26a0\ufe0f WAL checkpoint failed (backup may be incomplete): ${e instanceof Error ? e.message : e}`);
    }
    fs.copyFileSync(config.dbPath, backupPath);
    console.log(`\u{1f4e6} DB backup: ${backupPath}`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f DB backup failed: ${e instanceof Error ? e.message : e}`);
  }

  // Query all documents for export
  let docs: any[] = [];
  try {
    docs = sqlite.prepare(`
      SELECT d.id, d.type, d.source_file, d.concepts, d.project, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON d.id = f.id
    `).all() as any[];
  } catch (e) {
    console.warn(`\u26a0\ufe0f Query failed: ${e instanceof Error ? e.message : e}`);
    return;
  }

  // 2. Export to JSON (portable, human-readable)
  try {
    const exportData = {
      exported_at: new Date().toISOString(),
      count: docs.length,
      documents: docs.map(d => ({
        ...d,
        concepts: JSON.parse(d.concepts || '[]')
      }))
    };
    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
    console.log(`\u{1f4c4} JSON export: ${jsonPath} (${docs.length} docs)`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f JSON export failed: ${e instanceof Error ? e.message : e}`);
  }

  // 3. Export to CSV (DuckDB-friendly)
  try {
    const escapeCSV = (val: string) => {
      if (val.includes('"') || val.includes(',') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const header = 'id,type,source_file,concepts,project,content';
    const rows = docs.map(d =>
      [d.id, d.type, d.source_file, d.concepts, d.project || '', d.content]
        .map(v => escapeCSV(String(v || '')))
        .join(',')
    );

    fs.writeFileSync(csvPath, [header, ...rows].join('\n'));
    console.log(`\u{1f4ca} CSV export: ${csvPath} (${docs.length} rows)`);
  } catch (e) {
    console.warn(`\u26a0\ufe0f CSV export failed: ${e instanceof Error ? e.message : e}`);
  }

  const keepRaw = process.env.ORACLE_BACKUP_KEEP;
  const parsed = keepRaw !== undefined ? parseInt(keepRaw, 10) : DEFAULT_BACKUP_KEEP;
  const keep = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BACKUP_KEEP;
  rotateBackups(config.dbPath, keep);
}
