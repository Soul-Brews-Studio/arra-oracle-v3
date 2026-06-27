/**
 * Oracle Vault Migration Tool
 *
 * Scans ghq repos for ψ/ directories and copies knowledge
 * to the central brain vault with project-first paths.
 *
 * Usage:
 *   bun run vault:migrate              # scan + copy all ψ/ to vault
 *   bun run vault:migrate --dry-run    # preview what would be copied
 *   bun run vault:migrate --list       # just list repos with ψ/
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getSetting } from '../db/index.ts';
import { detectProject } from '../server/project-detect.ts';
import { mapToVaultPath, ensureFrontmatterProject } from './handler.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveVaultPath(repo: string): string {
  const output = execSync(`ghq list -p ${repo}`, { encoding: 'utf-8' }).trim();
  if (!output) throw new Error(`Vault repo "${repo}" not found via ghq.`);
  return output.split('\n')[0].trim();
}

function walkFiles(
  dir: string,
  baseDir: string,
): Array<{ relativePath: string; fullPath: string }> {
  const results: Array<{ relativePath: string; fullPath: string }> = [];
  if (!fs.existsSync(dir)) return results;

  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, baseDir));
    } else {
      results.push({ relativePath: path.relative(baseDir, fullPath), fullPath });
    }
  }
  return results;
}

// Categories that get project-nested
const PROJECT_CATEGORIES = [
  'ψ/memory/learnings/',
  'ψ/memory/retrospectives/',
  'ψ/inbox/handoff/',
];

function isProjectCategory(relativePath: string): boolean {
  return PROJECT_CATEGORIES.some((cat) => relativePath.startsWith(cat));
}

function sameFileContent(dest: string, source: string, content?: string): boolean {
  if (!fs.existsSync(dest)) return false;
  if (content !== undefined) return fs.readFileSync(dest, 'utf-8') === content;
  return fs.readFileSync(dest).equals(fs.readFileSync(source));
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

interface RepoInfo {
  repoPath: string;
  project: string;
  fileCount: number;
}

interface MigrateResult {
  reposFound: number;
  filesCopied: number;
  repos: RepoInfo[];
  skipped: string[];
  symlinked: string[];
}

/**
 * Find all ghq repos that have a ψ/ directory
 */
function findPsiRepos(): Array<{ repoPath: string; psiDir: string }> {
  try {
    execSync('ghq root', { encoding: 'utf-8' });
  } catch {
    throw new Error('ghq not found. Install ghq to use vault:migrate.');
  }

  const results: Array<{ repoPath: string; psiDir: string }> = [];

  // List all ghq repos and check for ψ/ in each
  const repos = execSync('ghq list -p', { encoding: 'utf-8' }).trim().split('\n');

  for (const repoPath of repos) {
    if (!repoPath) continue;
    const psiDir = path.join(repoPath, 'ψ');
    if (fs.existsSync(psiDir) && fs.statSync(psiDir).isDirectory()) {
      results.push({ repoPath, psiDir });
    }
  }

  return results;
}

/**
 * Migrate all ψ/ directories to the central vault
 */
function migrate(opts: { dryRun: boolean; symlink?: boolean }): MigrateResult {
  const { dryRun, symlink } = opts;

  const repo = getSetting('vault_repo');
  if (!repo) throw new Error('Vault not initialized. Run vault:init first.');

  const vaultPath = resolveVaultPath(repo);
  const psiRepos = findPsiRepos();
  const result: MigrateResult = {
    reposFound: psiRepos.length,
    filesCopied: 0,
    repos: [],
    skipped: [],
    symlinked: [],
  };

  // Skip the vault repo itself
  const vaultRealPath = fs.realpathSync(vaultPath);

  for (const { repoPath, psiDir } of psiRepos) {
    // Skip worktrees
    if (repoPath.match(/\.wt[-/]/)) {
      result.skipped.push(`${repoPath} (worktree)`);
      continue;
    }

    // Skip already-symlinked repos (nothing to copy)
    try {
      if (fs.lstatSync(psiDir).isSymbolicLink()) {
        result.skipped.push(`${repoPath} (already symlinked)`);
        continue;
      }
    } catch { /* doesn't exist, continue */ }

    const repoRealPath = fs.realpathSync(repoPath);
    if (repoRealPath === vaultRealPath) {
      result.skipped.push(`${repoPath} (vault repo itself)`);
      continue;
    }

    const project = detectProject(repoPath) ?? null;
    if (!project) {
      result.skipped.push(`${repoPath} (cannot detect project)`);
      continue;
    }

    const files = walkFiles(psiDir, repoPath);
    let fileCount = 0;

    for (const { relativePath, fullPath } of files) {
      // Skip .gitkeep files
      if (path.basename(relativePath) === '.gitkeep') continue;

      const vaultRelPath = mapToVaultPath(relativePath, project);
      const dest = path.join(vaultPath, vaultRelPath);
      const content = fullPath.endsWith('.md') && isProjectCategory(relativePath)
        ? ensureFrontmatterProject(fs.readFileSync(fullPath, 'utf-8'), project)
        : undefined;

      if (sameFileContent(dest, fullPath, content)) continue;

      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });

        if (content !== undefined) fs.writeFileSync(dest, content);
        else fs.copyFileSync(fullPath, dest);
      }
      fileCount++;
    }

    result.repos.push({ repoPath, project, fileCount });
    result.filesCopied += fileCount;

    // Create symlink if requested
    if (symlink) {
      const vaultPsiDir = path.join(vaultPath, project, 'ψ');
      if (!dryRun) {
        // Ensure vault destination exists
        fs.mkdirSync(vaultPsiDir, { recursive: true });
        // Remove local ψ/ directory
        fs.rmSync(psiDir, { recursive: true });
        // Create symlink: repo/ψ → vault/{project}/ψ
        fs.symlinkSync(vaultPsiDir, psiDir);
      }
      result.symlinked.push(project);
    }
  }

  // Git commit if not dry-run and there are changes
  if (!dryRun && result.filesCopied > 0) {
    try {
      execSync('git add -A', { cwd: vaultPath, stdio: 'pipe' });
      const status = execSync('git status --porcelain', {
        cwd: vaultPath,
        encoding: 'utf-8',
      }).trim();

      if (status) {
        const projectList = result.repos.map((r) => r.project).join(', ');
        execSync(
          `git commit -m "vault migrate: ${result.repos.length} repos (${result.filesCopied} files)\n\nProjects: ${projectList}"`,
          { cwd: vaultPath, stdio: 'pipe' },
        );
        execSync('git push', { cwd: vaultPath, stdio: 'pipe' });
        console.error(`[Vault] Migration committed and pushed`);
      }
    } catch (e) {
      console.error(`[Vault] Git commit/push failed:`, e instanceof Error ? e.message : e);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export { findPsiRepos, migrate };
export type { MigrateResult, RepoInfo };

// ---------------------------------------------------------------------------
// CLI (when run directly)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const repos = findPsiRepos();
    console.log(`Found ${repos.length} repos with ψ/ directories:\n`);
    for (const { repoPath, psiDir } of repos) {
      const project = detectProject(repoPath) ?? '(unknown)';
      const isSymlink = fs.lstatSync(psiDir).isSymbolicLink();
      if (isSymlink) {
        console.log(`  ${project} ✓ symlinked`);
      } else {
        const files = walkFiles(psiDir, repoPath);
        console.log(`  ${project} (${files.length} files) ← local`);
      }
      console.log(`    ${repoPath}`);
    }
  } else {
    const dryRun = args.includes('--dry-run');
    const symlink = args.includes('--symlink');
    if (dryRun) console.error('[Vault] DRY RUN — no files will be copied\n');
    if (symlink) console.error('[Vault] SYMLINK MODE — local ψ/ will be replaced with symlinks\n');

    const result = migrate({ dryRun, symlink });
    console.log(JSON.stringify(result, null, 2));
  }
}
