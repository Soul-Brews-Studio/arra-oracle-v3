import type { Database } from 'bun:sqlite';

/** Read-only sidecars can inspect an older DB without applying migrations. */
export function contentSource(sqlite: Database): 'oracle_content' | 'oracle_fts' {
  return sqlite.query("SELECT 1 FROM sqlite_master WHERE name = 'oracle_content' AND type = 'view'").get()
    ? 'oracle_content' : 'oracle_fts';
}
