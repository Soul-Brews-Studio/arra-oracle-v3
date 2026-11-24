/**
 * Manual vector snapshots: `lancedb-<model>-<vault sha>.tar.zst`. Never automatic, never in git.
 *
 *   create        pack the vector store (lancedb/ and/or vectors.db) + manifest.json
 *   push <dest>   copy it to a folder (hubs: see hub-client.ts)
 *   pull <src>    take a snapshot whose model AND vault sha match this node; anything else is
 *                 refused and `arra sync` embeds the diff instead
 *
 * A snapshot holds document text inside the vector rows, so it may only be made from an arra
 * that holds no private memory (bySource.self = 0, e.g. the hub's vault-only arra). Pull moves
 * the old vector store aside (`*.prev-<time>`) instead of deleting it.
 */

import type { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { headSha } from './git.ts';
import { readConfig, readHubs, dataDir } from './state.ts';
import { docCountsBySource, embedderInfo, SELF } from './status.ts';

const VECTOR_PARTS = ['lancedb', 'vectors.db'];
export interface SnapshotKey { model: string; sha: string }
export interface SnapshotManifest extends SnapshotKey { file: string; createdAt: string; node: string; docs: Record<string, number>; parts: string[] }

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'none';
export const snapshotName = (key: SnapshotKey, ext = 'tar.zst') => `lancedb-${safe(key.model)}-${key.sha.slice(0, 12)}.${ext}`;
export const snapshotDir = (dir = dataDir()) => path.join(dir, 'snapshots');

/** The vault commit this node's shared rows come from: the connected vault, else the last hub sync. */
export function currentKey(dir = dataDir(), vaultName?: string): SnapshotKey {
  const config = readConfig(dir);
  const vault = config?.vaults.find((v) => !vaultName || v.name === vaultName.replace(/^hub:/, ''));
  const hub = readHubs(dir).find((h) => !vaultName || h.name === vaultName.replace(/^hub:/, ''));
  const sha = (vault && headSha(vault.path)) || hub?.lastSyncSha;
  if (!sha) throw new Error('no vault commit known: connect a vault (arra init --vault) or arra sync a hub first');
  return { model: embedderInfo().model, sha };
}

function tar(args: string[], cwd: string): void {
  const proc = Bun.spawnSync(['tar', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 30 * 60_000 });
  if (proc.exitCode !== 0) throw new Error(`tar ${args[0]} failed: ${proc.stderr.toString().trim()}`);
}

export function createSnapshot(sqlite: Database, opts: { vault?: string; dir?: string } = {}): SnapshotManifest {
  const dir = opts.dir ?? dataDir();
  const docs = docCountsBySource(sqlite);
  if ((docs[SELF] ?? 0) > 0) {
    throw new Error(`refused: this arra holds ${docs[SELF]} private documents and a snapshot carries text; make snapshots on a vault-only arra (the hub)`);
  }
  const key = currentKey(dir, opts.vault);
  const parts = VECTOR_PARTS.filter((p) => fs.existsSync(path.join(dir, p)));
  const file = snapshotName(key);
  const manifest: SnapshotManifest = { ...key, file, createdAt: new Date().toISOString(), node: readConfig(dir)?.name ?? 'arra', docs, parts };
  fs.mkdirSync(snapshotDir(dir), { recursive: true });
  const stage = fs.mkdtempSync(path.join(snapshotDir(dir), '.stage-'));
  try {
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const part of parts) fs.cpSync(path.join(dir, part), path.join(stage, part), { recursive: true });
    tar(['--zstd', '-cf', path.join(snapshotDir(dir), file), 'manifest.json', ...parts], stage);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return manifest;
}

export function readManifest(archive: string): SnapshotManifest {
  const out = fs.mkdtempSync(path.join(path.dirname(archive), '.peek-'));
  try {
    tar(['--zstd', '-xf', archive, 'manifest.json'], out);
    return JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf-8')) as SnapshotManifest;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

export function pushSnapshotToDir(destDir: string, file?: string, dir = dataDir()): { file: string; to: string; bytes: number } {
  const name = file ?? fs.readdirSync(snapshotDir(dir)).filter((f) => f.endsWith('.tar.zst')).sort().pop();
  if (!name) throw new Error('no snapshot to push: arra snapshot create first');
  fs.mkdirSync(destDir, { recursive: true });
  const to = path.join(destDir, name);
  fs.copyFileSync(path.join(snapshotDir(dir), name), to);
  return { file: name, to, bytes: fs.statSync(to).size };
}

export interface PullResult { matched: boolean; wanted: string; file?: string; restored?: string[]; movedAside?: string[]; reason?: string }

/** Unpack `archive` over this node's vector store if its key matches; else refuse. */
export function applySnapshot(archive: string, dir = dataDir(), vault?: string): PullResult {
  const key = currentKey(dir, vault);
  const wanted = snapshotName(key);
  const manifest = readManifest(archive);
  if (manifest.model !== key.model || manifest.sha.slice(0, 12) !== key.sha.slice(0, 12)) {
    return { matched: false, wanted, file: path.basename(archive), reason: `snapshot is ${manifest.model}@${manifest.sha.slice(0, 12)}, this node needs ${key.model}@${key.sha.slice(0, 12)}: run arra sync (embeds the diff)` };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const movedAside: string[] = [];
  for (const part of manifest.parts) {
    const target = path.join(dir, part);
    if (fs.existsSync(target)) { fs.renameSync(target, `${target}.prev-${stamp}`); movedAside.push(`${part}.prev-${stamp}`); }
  }
  tar(['--zstd', '-xf', archive, ...manifest.parts], dir);
  return { matched: true, wanted, file: path.basename(archive), restored: manifest.parts, movedAside };
}

/** Pull from a folder: pick the snapshot named for this node's key. */
export function pullSnapshotFromDir(srcDir: string, dir = dataDir(), vault?: string): PullResult {
  const wanted = snapshotName(currentKey(dir, vault));
  const candidate = path.join(srcDir, wanted);
  if (!fs.existsSync(candidate)) {
    const have = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => f.endsWith('.tar.zst')) : [];
    return { matched: false, wanted, reason: `no ${wanted} in ${srcDir} (have: ${have.join(', ') || 'none'}): run arra sync (embeds the diff)` };
  }
  fs.mkdirSync(snapshotDir(dir), { recursive: true });
  const local = path.join(snapshotDir(dir), wanted);
  if (path.resolve(candidate) !== path.resolve(local)) fs.copyFileSync(candidate, local);
  return applySnapshot(local, dir, vault);
}
