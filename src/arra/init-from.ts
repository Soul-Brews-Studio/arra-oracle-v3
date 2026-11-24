/**
 * `arra init --from <old data dir>`: copy this folder's rows out of an older shared DB
 * (usually `~/.arra-oracle-v2`) into the new `.arra/oracle.db`.
 *
 * "This folder's rows" = documents whose `project` names this repo (github.com/<org>/<repo>,
 * read from the git remote) or whose source file lives under this folder. The old DB is opened
 * read-only and never changed. Rows already present (same id) are left alone.
 */

import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { git } from './git.ts';

const COLUMNS = [
  'id', 'type', 'source_file', 'concepts', 'created_at', 'updated_at', 'indexed_at',
  'superseded_by', 'superseded_at', 'superseded_reason', 'origin', 'project', 'created_by',
] as const;

/** github.com/org/repo for the folder's origin remote, lower-cased; null without one. */
export function projectSlug(dir: string): string | null {
  const r = git(dir, ['remote', 'get-url', 'origin']);
  if (!r.ok) return null;
  const m = r.out.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return m ? `github.com/${m[1]}/${m[2]}`.toLowerCase() : null;
}

function oldDbPath(from: string): string {
  const resolved = path.resolve(from.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
  return fs.statSync(resolved).isDirectory() ? path.join(resolved, 'oracle.db') : resolved;
}

export function copyRowsFrom(from: string, dataDir: string, dir: string): number {
  const source = oldDbPath(from);
  if (!fs.existsSync(source)) throw new Error(`--from: no oracle.db at ${source}`);
  const target = path.join(dataDir, 'oracle.db');
  if (path.resolve(source) === path.resolve(target)) return 0;

  const old = new Database(source, { readonly: true });
  const fresh = new Database(target);
  try {
    const project = projectSlug(dir);
    const where: string[] = [];
    const params: string[] = [];
    if (project) { where.push('lower(project) = ?'); params.push(project); }
    where.push('source_file LIKE ?');
    params.push(`${dir}/%`);
    const rows = old.query(`SELECT ${COLUMNS.join(', ')} FROM oracle_documents WHERE ${where.join(' OR ')}`)
      .all(...params) as Array<Record<string, unknown>>;
    const ftsOf = old.query('SELECT content, concepts FROM oracle_fts WHERE id = ?');
    const exists = fresh.query('SELECT 1 FROM oracle_documents WHERE id = ?');
    const insertDoc = fresh.query(
      `INSERT INTO oracle_documents (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
    );
    const insertFts = fresh.query('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
    let copied = 0;
    fresh.transaction(() => {
      for (const row of rows) {
        if (exists.get(row.id as string)) continue;
        insertDoc.run(...COLUMNS.map((c) => (row[c] ?? null) as string | number | null));
        const fts = ftsOf.get(row.id as string) as { content: string; concepts: string } | null;
        if (fts) insertFts.run(row.id as string, fts.content, fts.concepts);
        copied += 1;
      }
    })();
    return copied;
  } finally {
    old.close();
    fresh.close();
  }
}
