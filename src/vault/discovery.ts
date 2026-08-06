/**
 * Vault filesystem helpers — walking, cleanup, path resolution.
 */

import fs from 'fs';
import path from 'path';
import { getSetting } from '../db/index.ts';
import { ghqListPaths } from './ghq.ts';

/**
 * Directory names that are never knowledge, and are never descended into.
 *
 * A repo with a nested checkout or a vendored dependency inside ψ/ otherwise drags its
 * whole object database into the walk — thousands of binary pack files, and an EACCES on
 * the read-only ones. `.git` is matched as a bare name so the gitfile *pointer* a
 * submodule or worktree leaves behind is skipped too; that file is not knowledge either.
 *
 * Reported against `vault:migrate` by @tenzaitech (#2802), but the guard belongs here:
 * every caller of this walker wants it, and `vault:sync` walked the same trees.
 */
const NEVER_WALK = new Set(['.git', 'node_modules']);

/**
 * Walk all files under dir, skipping symlinks.
 * Returns paths relative to baseDir.
 */
export function walkFiles(
  dir: string,
  baseDir: string,
): Array<{ relativePath: string; fullPath: string }> {
  const results: Array<{ relativePath: string; fullPath: string }> = [];
  if (!fs.existsSync(dir)) return results;

  let items: string[];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return results;
  }

  for (const item of items) {
    if (NEVER_WALK.has(item)) continue;
    const fullPath = path.join(dir, item);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(fullPath); // lstat: don't follow symlinks
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else {
      results.push({ relativePath: path.relative(baseDir, fullPath).replaceAll(path.sep, '/'), fullPath });
    }
  }
  return results;
}

export function resolveVaultPath(repo: string): string {
  try {
    const [first] = ghqListPaths(repo);
    if (!first) throw new Error('empty output');
    return first;
  } catch {
    throw new Error(`Vault repo "${repo}" not found via ghq. Run vault:init first.`);
  }
}

export function cleanEmptyDirs(dir: string, stopAt: string): void {
  if (dir === stopAt || !fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  if (items.length === 0) {
    fs.rmdirSync(dir);
    cleanEmptyDirs(path.dirname(dir), stopAt);
  }
}

/**
 * Resolve the vault ψ/ root for shared use by oracle_learn, oracle_handoff, indexer, etc.
 * Returns the vault repo local path, or a setup hint if not configured.
 */
export function getVaultPsiRoot(): { path: string } | { needsInit: true; hint: string } {
  const repo = getSetting('vault_repo');
  if (!repo) {
    return {
      needsInit: true,
      hint: 'Run: oracle-vault init <owner/repo> to set up central knowledge vault.\nExample: oracle-vault init your-org/oracle-vault',
    };
  }
  try {
    return { path: resolveVaultPath(repo) };
  } catch {
    return {
      needsInit: true,
      hint: `Vault repo "${repo}" not found locally. Run: ghq get ${repo}`,
    };
  }
}
