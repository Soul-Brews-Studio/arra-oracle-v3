/**
 * Vault time travel (#3110): the vault's git log is the hub's backup timeline. Each commit is a
 * point you can open read-only (which notes existed, what changed); snapshots attach to the
 * commit they were cut from. Nothing here writes: going back never rewrites history.
 */
import fs from 'fs';
import { git } from './git.ts';
import { readConfig } from './state.ts';
import { snapshotDir } from './snapshot.ts';

export type EventKind = 'init' | 'share' | 'retire' | 'other';
export interface FileChange { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }
export interface HistoryEvent { sha: string; short: string; at: string; author: string; subject: string; kind: EventKind; changes: FileChange[]; snapshots: string[] }
export interface VaultAt { sha: string; at: string; subject: string; notes: Array<{ path: string; title: string }>; sinceThen: FileChange[] }

const SHA = /^[0-9a-f]{7,40}$/;
const STATUS: Record<string, FileChange['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };
const kindOf = (subject: string): EventKind =>
  /^init\b/.test(subject) ? 'init' : /^share:/.test(subject) ? 'share' : /^retire:/.test(subject) ? 'retire' : 'other';

export function historyVault(dir?: string) {
  const vault = readConfig(dir)?.vaults[0];
  if (!vault) throw new Error('no vault connected: arra init --vault <path>');
  return vault;
}

function changesOf(out: string): FileChange[] {
  return out.split('\n').filter(Boolean).map((line) => {
    const [code, ...paths] = line.split('\t');
    return { path: paths[paths.length - 1], status: STATUS[code[0]] ?? 'modified' };
  });
}

/** Newest first. Snapshot files are named lancedb-<model>-<sha12>.tar.zst, so they match by sha prefix. */
export function vaultHistory(limit = 100, dir?: string): { vault: string; head: string | null; events: HistoryEvent[] } {
  const vault = historyVault(dir);
  const log = git(vault.path, ['log', `-n${Math.min(Math.max(limit, 1), 500)}`, '--name-status', '--format=%x1e%H%x1f%aI%x1f%an%x1f%s']);
  if (!log.ok) throw new Error(`git log failed in vault ${vault.name}: ${log.err}`);
  const snapDir = snapshotDir(dir);
  const snaps = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter((f) => f.endsWith('.tar.zst') || f.endsWith('.tar.gz')) : [];
  const events = log.out.split('\x1e').filter((c) => c.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [sha, at, author, subject] = head.split('\x1f');
    return { sha, short: sha.slice(0, 7), at, author, subject, kind: kindOf(subject), changes: changesOf(rest.join('\n')), snapshots: snaps.filter((f) => f.includes(`-${sha.slice(0, 12)}.`)) };
  });
  return { vault: vault.name, head: events[0]?.sha ?? null, events };
}

function titleOf(vaultPath: string, sha: string, file: string): string {
  const r = git(vaultPath, ['show', `${sha}:${file}`]);
  const h = r.ok ? r.out.split('\n').find((l) => /^#\s+/.test(l)) : undefined;
  return h ? h.replace(/^#\s+/, '').trim() : file.split('/').pop()!.replace(/\.md$/, '');
}

/** The vault as it was at `sha`: its notes, and what changed between then and now. */
export function vaultAt(sha: string, dir?: string): VaultAt {
  if (!SHA.test(sha)) throw new Error('sha must be 7-40 hex characters');
  const vault = historyVault(dir);
  const meta = git(vault.path, ['show', '-s', '--format=%H%x1f%aI%x1f%s', sha]);
  if (!meta.ok) throw new Error(`no commit ${sha} in vault ${vault.name}`);
  const [full, at, subject] = meta.out.split('\x1f');
  const tree = git(vault.path, ['ls-tree', '-r', '--name-only', full]);
  const notes = tree.out.split('\n').filter((f) => f.endsWith('.md')).map((path) => ({ path, title: titleOf(vault.path, full, path) }));
  const diff = git(vault.path, ['diff', '--name-status', full, 'HEAD']);
  return { sha: full, at, subject, notes, sinceThen: diff.ok ? changesOf(diff.out) : [] };
}

/** One note's markdown at `sha`. Only paths that exist in that commit's tree are readable. */
export function noteAt(sha: string, file: string, dir?: string): string {
  if (!SHA.test(sha)) throw new Error('sha must be 7-40 hex characters');
  const vault = historyVault(dir);
  const tree = git(vault.path, ['ls-tree', '-r', '--name-only', sha]);
  if (!tree.ok || !tree.out.split('\n').includes(file)) throw new Error(`no file ${file} at ${sha}`);
  return git(vault.path, ['show', `${sha}:${file}`]).out;
}
