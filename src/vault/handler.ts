/** Oracle Vault Handler — backs up ψ/ to a private GitHub repo with project-first paths. */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getSetting, setSetting } from '../db/index.ts';
import { detectProject } from '../server/project-detect.ts';
import { ORACLE_DATA_DIR } from '../config.ts';
import { walkFiles, resolveVaultPath, cleanEmptyDirs } from './discovery.ts';
import { mapToVaultPath, ensureFrontmatterProject, isProjectCategory, UNIVERSAL_CATEGORIES } from './path-mapping.ts';
import { parseGitStatus } from './git.ts';

// Re-export sub-modules for backward compatibility
export { mapToVaultPath, mapFromVaultPath, ensureFrontmatterProject } from './path-mapping.ts';
export { parseGitStatus, type GitStatusCounts } from './git.ts';
export { getVaultPsiRoot } from './discovery.ts';

export interface InitResult { repo: string; vaultPath: string; created: boolean }

export function initVault(repo: string): InitResult {
  let created = false;
  try {
    const existing = execSync(`ghq list -p ${repo}`, { encoding: 'utf-8' }).trim();
    if (!existing) throw new Error('not found');
  } catch {
    execSync(`ghq get ${repo}`, { encoding: 'utf-8', stdio: 'pipe' });
    created = true;
  }
  const vaultPath = resolveVaultPath(repo);
  setSetting('vault_repo', repo);
  setSetting('vault_enabled', 'true');

  const psiSymlink = path.join(ORACLE_DATA_DIR, 'ψ');
  const vaultPsiDir = path.join(vaultPath, 'ψ');
  if (!fs.existsSync(ORACLE_DATA_DIR)) fs.mkdirSync(ORACLE_DATA_DIR, { recursive: true });
  if (!fs.existsSync(psiSymlink) && fs.existsSync(vaultPsiDir)) {
    fs.symlinkSync(vaultPsiDir, psiSymlink);
    console.error(`[Vault] Symlink: ${psiSymlink} → ${vaultPsiDir}`);
  }

  console.error(`[Vault] Initialized: ${repo} → ${vaultPath}`);
  return { repo, vaultPath, created };
}

export interface SyncResult {
  dryRun: boolean; added: number; modified: number; deleted: number;
  commitHash?: string; project?: string | null;
}

export function syncVault(opts: { dryRun?: boolean; repoRoot: string }): SyncResult {
  const { dryRun = false, repoRoot } = opts;
  const repo = getSetting('vault_repo');
  if (!repo) throw new Error('Vault not initialized. Run vault:init first.');

  const vaultPath = resolveVaultPath(repo);
  const psiDir = path.join(repoRoot, 'ψ');
  if (!fs.existsSync(psiDir)) throw new Error(`ψ/ directory not found at ${psiDir}`);

  const project = detectProject(repoRoot) ?? null;
  console.error(`[Vault] Project: ${project || '(universal)'}`);

  const diskFiles = walkFiles(psiDir, repoRoot);
  const vaultDestPaths = new Set<string>();

  for (const { relativePath, fullPath } of diskFiles) {
    const vaultRelPath = mapToVaultPath(relativePath, project);
    vaultDestPaths.add(vaultRelPath);
    const dest = path.join(vaultPath, vaultRelPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (project && fullPath.endsWith('.md') && isProjectCategory(relativePath)) {
      const tagged = ensureFrontmatterProject(fs.readFileSync(fullPath, 'utf-8'), project);
      fs.writeFileSync(dest, tagged);
    } else {
      fs.copyFileSync(fullPath, dest);
    }
  }

  // Clean up vault files that no longer exist locally
  if (project) {
    const vaultProjectDir = path.join(vaultPath, project, 'ψ');
    if (fs.existsSync(vaultProjectDir)) {
      for (const { relativePath: vr, fullPath: vf } of walkFiles(vaultProjectDir, vaultPath)) {
        if (!vaultDestPaths.has(vr)) { fs.unlinkSync(vf); cleanEmptyDirs(path.dirname(vf), path.join(vaultPath, project)); }
      }
    }
  }
  for (const category of UNIVERSAL_CATEGORIES) {
    const vaultCategoryDir = path.join(vaultPath, category);
    if (!fs.existsSync(vaultCategoryDir)) continue;
    for (const { relativePath: vr, fullPath: vf } of walkFiles(vaultCategoryDir, vaultPath)) {
      if (!vaultDestPaths.has(vr)) { fs.unlinkSync(vf); cleanEmptyDirs(path.dirname(vf), path.join(vaultPath, 'ψ')); }
    }
  }

  execSync('git add -A', { cwd: vaultPath, stdio: 'pipe' });
  const status = execSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim();
  const { added, modified, deleted } = parseGitStatus(status);
  if (dryRun || !status) return { dryRun: true, added, modified, deleted, project };

  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const parts: string[] = [];
  if (added) parts.push(`+${added}`);
  if (modified) parts.push(`~${modified}`);
  if (deleted) parts.push(`-${deleted}`);
  const summary = parts.length ? ` (${parts.join(', ')})` : '';
  const projectTag = project ? ` [${project}]` : '';

  execSync(`git commit -m "vault sync: ${ts}${summary}${projectTag}"`, { cwd: vaultPath, stdio: 'pipe' });
  const commitHash = execSync('git rev-parse --short HEAD', { cwd: vaultPath, encoding: 'utf-8' }).trim();
  execSync('git push', { cwd: vaultPath, stdio: 'pipe' });
  setSetting('vault_last_sync', String(now.getTime()));

  console.error(`[Vault] Synced: +${added} ~${modified} -${deleted} (${commitHash})`);
  return { dryRun: false, added, modified, deleted, commitHash, project };
}

export interface PullResult { files: number; project: string }

export function pullVault(opts: { repoRoot: string }): PullResult {
  const { repoRoot } = opts;
  const repo = getSetting('vault_repo');
  if (!repo) throw new Error('Vault not initialized. Run vault:init first.');

  const vaultPath = resolveVaultPath(repo);
  const project = detectProject(repoRoot) ?? null;
  if (!project) throw new Error('Cannot detect project from repoRoot. Pull requires project context.');

  try { execSync('git pull', { cwd: vaultPath, stdio: 'pipe' }); }
  catch { console.error('[Vault] git pull failed — continuing with local vault state'); }

  let fileCount = 0;
  const vaultProjectPsi = path.join(vaultPath, project, 'ψ');
  if (fs.existsSync(vaultProjectPsi)) {
    for (const { relativePath, fullPath: vf } of walkFiles(vaultProjectPsi, vaultProjectPsi)) {
      if (path.basename(relativePath) === '.gitkeep') continue;
      const localDest = path.join(repoRoot, 'ψ', relativePath);
      fs.mkdirSync(path.dirname(localDest), { recursive: true });
      fs.copyFileSync(vf, localDest);
      fileCount++;
    }
  }
  for (const category of UNIVERSAL_CATEGORIES) {
    const vaultCategoryDir = path.join(vaultPath, category);
    if (!fs.existsSync(vaultCategoryDir)) continue;
    for (const { relativePath, fullPath: vf } of walkFiles(vaultCategoryDir, path.join(vaultPath, category))) {
      if (relativePath === '.gitkeep') continue;
      const localDest = path.join(repoRoot, category, relativePath);
      fs.mkdirSync(path.dirname(localDest), { recursive: true });
      fs.copyFileSync(vf, localDest);
      fileCount++;
    }
  }
  console.error(`[Vault] Pulled ${fileCount} files for ${project}`);
  return { files: fileCount, project };
}

export interface VaultStatusResult {
  enabled: boolean; repo: string | null; lastSync: string | null; vaultPath: string | null;
  pending?: { added: number; modified: number; deleted: number; total: number };
}

export function vaultStatus(repoRoot: string): VaultStatusResult {
  const repo = getSetting('vault_repo');
  const enabled = getSetting('vault_enabled') === 'true';
  const lastSyncMs = getSetting('vault_last_sync');
  if (!repo || !enabled) return { enabled: false, repo: null, lastSync: null, vaultPath: null };

  let vaultPath: string | null = null;
  try { vaultPath = resolveVaultPath(repo); } catch {
    return { enabled: true, repo, lastSync: lastSyncMs ? new Date(Number(lastSyncMs)).toISOString() : null, vaultPath: null };
  }

  let pending = { added: 0, modified: 0, deleted: 0, total: 0 };
  try {
    const status = execSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim();
    const counts = parseGitStatus(status);
    pending = { ...counts, total: counts.added + counts.modified + counts.deleted };
  } catch { /* git status failed */ }

  return { enabled: true, repo, lastSync: lastSyncMs ? new Date(Number(lastSyncMs)).toISOString() : null, vaultPath, pending };
}
