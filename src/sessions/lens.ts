/**
 * Read-only access to the jsonl-lens session corpus.
 *
 * The corpus (`all.db`, ~2.7 GB — 6,024 sessions / 1,031,567 beats on m5) is produced by the
 * `jsonl-lens` maw plugin via `just export-turso`. We **attach it read-only and never write**:
 *
 *  - it is a rebuildable export, so a bad read is fixed by re-running the exporter, not by
 *    restoring a backup;
 *  - keeping it out of oracle.db keeps it out of the indexer's pre-run full-database backup,
 *    which would otherwise copy 2.7 GB on every reindex;
 *  - and out of reach of smart-delete reconciliation (#2996), which only addresses
 *    oracle_documents.
 *
 * Absence is normal, not an error: most machines will not have the export. Every entry point
 * degrades to `available: false` with a reason rather than throwing, so an Oracle without the
 * corpus loses session search and nothing else.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

export const DEFAULT_LENS_PATH = '/opt/data/.lens/all.db';

/** Conversation turns. Excludes `tool`, which is 50.5% of rows but 69% of the text. */
export const CONVERSATION_WHO = ['human', 'assistant', 'thinking'] as const;

export interface LensStatus {
  available: boolean;
  path: string;
  reason?: string;
  sessions?: number;
  beats?: number;
}

let cached: { db: Database; path: string } | null = null;

export function lensPath(): string {
  return process.env.ORACLE_LENS_DB?.trim() || DEFAULT_LENS_PATH;
}

/**
 * Open the corpus read-only, memoised. Returns null when unavailable — callers report a reason
 * rather than failing, since a missing export is an ordinary state.
 */
export function openLens(): Database | null {
  const path = lensPath();
  if (cached && cached.path === path) return cached.db;
  if (cached) { try { cached.db.close(); } catch { /* ignore */ } cached = null; }
  if (!existsSync(path)) return null;
  try {
    const db = new Database(path, { readonly: true });
    // Cheap proof the file is actually a lens export and not merely present.
    db.query('SELECT 1 FROM sessions LIMIT 1').get();
    cached = { db, path };
    return db;
  } catch {
    return null;
  }
}

export function lensStatus(): LensStatus {
  const path = lensPath();
  if (!existsSync(path)) {
    return { available: false, path, reason: `No session corpus at ${path}. Produce one with \`just export-turso\` in jsonl-lens, or set ORACLE_LENS_DB.` };
  }
  const db = openLens();
  if (!db) {
    return { available: false, path, reason: `${path} exists but is not a readable lens export (missing 'sessions' table or locked).` };
  }
  try {
    const s = db.query('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    const b = db.query('SELECT COUNT(*) AS n FROM beats').get() as { n: number };
    return { available: true, path, sessions: s.n, beats: b.n };
  } catch (error) {
    return { available: false, path, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Test seam — drops the memoised handle so a test can point ORACLE_LENS_DB elsewhere. */
export function resetLens(): void {
  if (cached) { try { cached.db.close(); } catch { /* ignore */ } }
  cached = null;
}
