/**
 * Vault filesystem helpers — walking, cleanup, path resolution.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getSetting } from '../db/index.ts';

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

  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const stat = fs.lstatSync(fullPath); // lstat: don't follow symlinks
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else {
      results.push({ relativePath: path.relative(baseDir, fullPath), fullPath });
    }
  }
  return results;
}

export function resolveVaultPath(repo: string): string {
  try {
    const output = execSync(`ghq list -p ${repo}`, { encoding: 'utf-8' }).trim();
    if (!output) throw new Error('empty output');
    return output.split('\n')[0].trim();
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
