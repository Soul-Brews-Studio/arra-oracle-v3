/**
 * Index the markdown of a shared vault into the local DB as source `hub:<name>`.
 *
 * The vault is the truth; these rows are a cache. A file is one document: id `hub:<name>:<path>`,
 * origin `hub:<name>`, FTS content = the body. Changed files are rewritten, new ones inserted.
 * A file that left the vault is SUPERSEDED (`superseded_by = '_vault_removed'`), never deleted —
 * git still has it, and the row says where it went.
 *
 * Vectors: every new or changed row is queued on the indexer job queue (one job per configured
 * model), so `arra sync` embeds only the diff. With no embedder the rows are FTS-only.
 */

import type { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { parseFrontmatterList, parseFrontmatterString, stripFrontmatter } from '../indexer/frontmatter.ts';
import { enqueueIndexJob } from '../indexer/jobs.ts';

export interface VaultFile { rel: string; content: string }
export interface IndexReport { files: number; added: number; updated: number; unchanged: number; removed: number; queued: number }

const SKIP_DIRS = new Set(['.git', '.arra', 'node_modules']);

/** Every `.md` file under `root`, relative paths, sorted. */
export function readVaultFiles(root: string): VaultFile[] {
  const out: VaultFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name)); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const abs = path.join(dir, entry.name);
      out.push({ rel: path.relative(root, abs).split(path.sep).join('/'), content: fs.readFileSync(abs, 'utf-8') });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

export const docIdFor = (vault: string, rel: string) => `hub:${vault}:${rel}`;

function docType(content: string, rel: string): string {
  const declared = parseFrontmatterString(content, ['type']);
  if (declared) return declared;
  if (/retrospectives?\//.test(rel)) return 'retro';
  if (/resonance\//.test(rel)) return 'principle';
  return 'learning';
}

function ftsBody(content: string, rel: string): string {
  const title = parseFrontmatterString(content, ['title']);
  const body = stripFrontmatter(content).trim();
  return title && !body.includes(title) ? `${title}\n\n${body}` : body || rel;
}

export function indexVaultFiles(
  sqlite: Database,
  vault: string,
  files: VaultFile[],
  opts: { models?: Record<string, { collection: string }>; tenantId?: string } = {},
): IndexReport {
  const origin = `hub:${vault}`;
  const tenant = opts.tenantId ?? 'default';
  const now = Date.now();
  const report: IndexReport = { files: files.length, added: 0, updated: 0, unchanged: 0, removed: 0, queued: 0 };
  const current = sqlite.query('SELECT content FROM oracle_fts WHERE id = ?');
  const existing = sqlite.query('SELECT id, superseded_by FROM oracle_documents WHERE id = ?');
  const insertDoc = sqlite.query(`INSERT INTO oracle_documents
    (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, origin, project, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`);
  const updateDoc = sqlite.query(`UPDATE oracle_documents SET type = ?, concepts = ?, updated_at = ?, indexed_at = ?,
    superseded_by = NULL, superseded_at = NULL, superseded_reason = NULL, created_by = ? WHERE id = ?`);
  const delFts = sqlite.query('DELETE FROM oracle_fts WHERE id = ?');
  const insFts = sqlite.query('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
  const changed: string[] = [];

  sqlite.transaction(() => {
    const seen = new Set<string>();
    for (const file of files) {
      const id = docIdFor(vault, file.rel);
      seen.add(id);
      const body = ftsBody(file.content, file.rel);
      const concepts = parseFrontmatterList(file.content, ['concepts', 'tags']);
      const by = parseFrontmatterString(file.content, ['shared_by', 'author']);
      const row = existing.get(id) as { id: string; superseded_by: string | null } | null;
      const prev = current.get(id) as { content: string } | null;
      if (row && prev?.content === body && !row.superseded_by) { report.unchanged += 1; continue; }
      if (row) {
        updateDoc.run(docType(file.content, file.rel), JSON.stringify(concepts), now, now, by, id);
        report.updated += 1;
      } else {
        insertDoc.run(id, tenant, docType(file.content, file.rel), `${origin}/${file.rel}`, JSON.stringify(concepts), now, now, now, origin, by);
        report.added += 1;
      }
      delFts.run(id);
      insFts.run(id, body, concepts.join(' '));
      changed.push(id);
    }
    const gone = sqlite.query(`SELECT id FROM oracle_documents WHERE origin = ? AND superseded_by IS NULL`).all(origin) as Array<{ id: string }>;
    const supersede = sqlite.query(`UPDATE oracle_documents SET superseded_by = '_vault_removed', superseded_at = ?,
      superseded_reason = 'file no longer in the vault (git history keeps it)' WHERE id = ?`);
    for (const { id } of gone) if (!seen.has(id)) { supersede.run(now, id); report.removed += 1; }
  })();

  if (opts.models && Object.keys(opts.models).length) {
    for (const id of changed) {
      try { report.queued += enqueueIndexJob(sqlite, { docId: id, models: opts.models }).length; } catch { /* no jobs table: FTS-only */ }
    }
  }
  return report;
}
