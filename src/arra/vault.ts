/**
 * Share into, and sync from, an org vault (a git repo of markdown). The vault is the truth.
 *
 *   share  write one note as `.md` into `<vault>/ψ/memory/shared/`, commit, push if it tracks a remote
 *   sync   pull every connected vault (fast-forward only) and index it as `hub:<name>`
 *
 * Nothing here forces or rewrites git history; a vault that cannot fast-forward is reported,
 * not repaired.
 */

import type { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { git, gitOrThrow, hasUpstream, headSha } from './git.ts';
import { readConfig, type VaultRef } from './state.ts';
import { indexVaultFiles, readVaultFiles, type IndexReport } from './vault-index.ts';

export interface ShareInput { id?: string; file?: string; text?: string; title?: string; vault?: string; concepts?: string[] }
export interface ShareResult { vault: string; path: string; rel: string; sha: string | null; pushed: boolean; created: boolean }

export function resolveVault(name?: string): VaultRef {
  const vaults = readConfig()?.vaults ?? [];
  const clean = name?.replace(/^hub:/, '').trim();
  if (clean) {
    const found = vaults.find((v) => v.name === clean) ?? (fs.existsSync(clean) ? { name: path.basename(path.resolve(clean)), path: path.resolve(clean) } : undefined);
    if (!found) throw new Error(`no vault named "${clean}" (connected: ${vaults.map((v) => v.name).join(', ') || 'none'}; add one with arra init --vault <path>)`);
    return found;
  }
  if (vaults.length === 1) return vaults[0];
  throw new Error(vaults.length ? `several vaults connected; pick one with --vault (${vaults.map((v) => v.name).join(', ')})` : 'no vault connected: arra init --vault <path>');
}

export function slug(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';
}

/** The note to share: a document id from this arra, a file on disk, or raw text. */
export function noteFrom(sqlite: Database, input: ShareInput): { title: string; body: string; concepts: string[]; originId: string | null } {
  if (input.text?.trim()) {
    const body = input.text.trim();
    return { title: input.title?.trim() || body.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80), body, concepts: input.concepts ?? [], originId: null };
  }
  if (input.file) {
    const abs = path.resolve(input.file);
    if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
    const body = fs.readFileSync(abs, 'utf-8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    return { title: input.title?.trim() || path.basename(abs, '.md'), body, concepts: input.concepts ?? [], originId: null };
  }
  if (input.id) {
    const doc = sqlite.query('SELECT id, concepts, origin FROM oracle_documents WHERE id = ?').get(input.id) as { id: string; concepts: string; origin: string | null } | null;
    if (!doc) throw new Error(`no document with id ${input.id}`);
    if (doc.origin?.startsWith('hub:')) throw new Error(`${input.id} already comes from ${doc.origin}`);
    const fts = sqlite.query('SELECT content FROM oracle_fts WHERE id = ?').get(input.id) as { content: string } | null;
    const body = (fts?.content ?? '').trim();
    if (!body) throw new Error(`document ${input.id} has no text to share`);
    let concepts: string[] = [];
    try { concepts = JSON.parse(doc.concepts); } catch { /* not JSON */ }
    return { title: input.title?.trim() || body.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80), body, concepts, originId: doc.id };
  }
  throw new Error('share needs a document id, a file, or text');
}

export function noteMarkdown(note: { title: string; body: string; concepts: string[]; originId: string | null }, by: string, at = new Date()): string {
  const fm = [
    '---',
    `title: ${JSON.stringify(note.title)}`,
    'type: learning',
    `shared_by: ${JSON.stringify(by)}`,
    `shared_at: ${at.toISOString()}`,
    ...(note.originId ? [`origin_id: ${JSON.stringify(note.originId)}`] : []),
    ...(note.concepts.length ? [`concepts: [${note.concepts.map((c) => JSON.stringify(c)).join(', ')}]`] : []),
    '---',
  ];
  return `${fm.join('\n')}\n\n${note.body}\n`;
}

const bodyOf = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

/** Write `markdown` into the vault, commit it, push when the branch tracks a remote. */
export function commitNote(vault: VaultRef, title: string, markdown: string, by: string, at = new Date()): ShareResult {
  const dir = path.join(vault.path, 'ψ', 'memory', 'shared');
  fs.mkdirSync(dir, { recursive: true });
  const base = `${at.toISOString().slice(0, 10)}_${slug(title)}`;
  let rel = `ψ/memory/shared/${base}.md`;
  for (let n = 2; fs.existsSync(path.join(vault.path, rel)); n += 1) {
    // same day, same title, same body (frontmatter times differ) → already shared
    if (bodyOf(fs.readFileSync(path.join(vault.path, rel), 'utf-8')) === bodyOf(markdown)) return { vault: vault.name, path: path.join(vault.path, rel), rel, sha: headSha(vault.path), pushed: false, created: false };
    rel = `ψ/memory/shared/${base}-${n}.md`;
  }
  fs.writeFileSync(path.join(vault.path, rel), markdown);
  gitOrThrow(vault.path, ['add', '--', rel]);
  gitOrThrow(vault.path, ['commit', '-q', '-m', `share: ${title.slice(0, 72)}`, '-m', `shared by ${by} via arra share`]);
  const pushed = hasUpstream(vault.path) && git(vault.path, ['push', '-q']).ok;
  return { vault: vault.name, path: path.join(vault.path, rel), rel, sha: headSha(vault.path), pushed, created: true };
}

export function shareToVault(sqlite: Database, input: ShareInput): ShareResult {
  const vault = resolveVault(input.vault);
  const by = readConfig()?.name ?? 'arra';
  const note = noteFrom(sqlite, input);
  return commitNote(vault, note.title, noteMarkdown(note, by), by);
}

export interface SyncReport extends IndexReport { vault: string; sha: string | null; pulled: 'ff' | 'up-to-date' | 'no-remote' | 'failed'; error?: string }

export function syncVault(sqlite: Database, vault: VaultRef, models?: Record<string, { collection: string }>): SyncReport {
  let pulled: SyncReport['pulled'] = 'no-remote';
  let error: string | undefined;
  if (hasUpstream(vault.path)) {
    const before = headSha(vault.path);
    const r = git(vault.path, ['pull', '-q', '--ff-only'], 120_000);
    pulled = !r.ok ? 'failed' : before === headSha(vault.path) ? 'up-to-date' : 'ff';
    if (!r.ok) error = r.err || r.out;
  }
  const report = indexVaultFiles(sqlite, vault.name, readVaultFiles(vault.path), { models });
  return { vault: `hub:${vault.name}`, sha: headSha(vault.path), pulled, ...(error ? { error } : {}), ...report };
}
