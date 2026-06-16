/** Oracle Vault Migration Tool — copies ghq ψ/ knowledge into a central vault. */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getSetting } from '../db/index.ts';
import { detectProject } from '../server/project-detect.ts';
import { mapToVaultPath, ensureFrontmatterProject } from './handler.ts';

function resolveVaultPath(repo: string): string {
  const output = execSync(`ghq list -p ${repo}`, { encoding: 'utf-8' }).trim();
  if (!output) throw new Error(`Vault repo "${repo}" not found via ghq.`);
  return output.split('\n')[0].trim();
}

function walkFiles(dir: string, baseDir: string): Array<{ relativePath: string; fullPath: string }> {
  const results: Array<{ relativePath: string; fullPath: string }> = [];
  if (!fs.existsSync(dir)) return results;

  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) results.push(...walkFiles(fullPath, baseDir));
    else results.push({ relativePath: path.relative(baseDir, fullPath), fullPath });
  }
  return results;
}

const PROJECT_CATEGORIES = ['ψ/memory/learnings/', 'ψ/memory/retrospectives/', 'ψ/inbox/handoff/'];

function isProjectCategory(relativePath: string): boolean {
  return PROJECT_CATEGORIES.some((cat) => relativePath.startsWith(cat));
}

interface RepoInfo { repoPath: string; project: string; fileCount: number }
interface MigrateOptions { dryRun: boolean; symlink?: boolean; tenantId?: string }
interface MigrateResult {
  reposFound: number;
  filesCopied: number;
  repos: RepoInfo[];
  skipped: string[];
  symlinked: string[];
}

function projectMatchesTenant(project: string, tenantId: string): boolean {
  const tenant = tenantId.trim().toLowerCase();
  const normalizedProject = project.trim().toLowerCase();
  if (!tenant) return true;
  if (normalizedProject === tenant) return true;
  return normalizedProject.split(/[\\/]+/).filter(Boolean).includes(tenant);
}

function findPsiRepos(): Array<{ repoPath: string; psiDir: string }> {
  try {
    execSync('ghq root', { encoding: 'utf-8' });
  } catch {
    throw new Error('ghq not found. Install ghq to use vault:migrate.');
  }

  const results: Array<{ repoPath: string; psiDir: string }> = [];
  const repos = execSync('ghq list -p', { encoding: 'utf-8' }).trim().split('\n');
  for (const repoPath of repos) {
    if (!repoPath) continue;
    const psiDir = path.join(repoPath, 'ψ');
    if (fs.existsSync(psiDir) && fs.statSync(psiDir).isDirectory()) results.push({ repoPath, psiDir });
  }
  return results;
}

function migrate(opts: MigrateOptions): MigrateResult {
  const { dryRun, symlink, tenantId } = opts;
  const repo = getSetting('vault_repo');
  if (!repo) throw new Error('Vault not initialized. Run vault:init first.');

  const vaultPath = resolveVaultPath(repo);
  const psiRepos = findPsiRepos();
  const result: MigrateResult = {
    reposFound: tenantId ? 0 : psiRepos.length,
    filesCopied: 0,
    repos: [],
    skipped: [],
    symlinked: [],
  };
  const vaultRealPath = fs.realpathSync(vaultPath);

  for (const { repoPath, psiDir } of psiRepos) {
    const project = detectProject(repoPath) ?? null;
    if (!project) {
      if (!tenantId) result.skipped.push(`${repoPath} (cannot detect project)`);
      continue;
    }
    if (tenantId && !projectMatchesTenant(project, tenantId)) continue;
    if (tenantId) result.reposFound++;

    if (repoPath.match(/\.wt[-/]/)) {
      result.skipped.push(`${repoPath} (worktree)`);
      continue;
    }
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

    const files = walkFiles(psiDir, repoPath);
    let fileCount = 0;
    for (const { relativePath, fullPath } of files) {
      if (path.basename(relativePath) === '.gitkeep') continue;
      const vaultRelPath = mapToVaultPath(relativePath, project);
      const dest = path.join(vaultPath, vaultRelPath);

      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fullPath.endsWith('.md') && isProjectCategory(relativePath)) {
          fs.writeFileSync(dest, ensureFrontmatterProject(fs.readFileSync(fullPath, 'utf-8'), project));
        } else {
          fs.copyFileSync(fullPath, dest);
        }
      }
      fileCount++;
    }

    result.repos.push({ repoPath, project, fileCount });
    result.filesCopied += fileCount;
    if (symlink) {
      const vaultPsiDir = path.join(vaultPath, project, 'ψ');
      if (!dryRun) {
        fs.mkdirSync(vaultPsiDir, { recursive: true });
        fs.rmSync(psiDir, { recursive: true });
        fs.symlinkSync(vaultPsiDir, psiDir);
      }
      result.symlinked.push(project);
    }
  }

  if (!dryRun && result.filesCopied > 0) {
    try {
      execSync('git add -A', { cwd: vaultPath, stdio: 'pipe' });
      const status = execSync('git status --porcelain', { cwd: vaultPath, encoding: 'utf-8' }).trim();

      if (status) {
        const projectList = result.repos.map((r) => r.project).join(', ');
        execSync(
          `git commit -m "vault migrate: ${result.repos.length} repos (${result.filesCopied} files)\n\nProjects: ${projectList}"`,
          { cwd: vaultPath, stdio: 'pipe' },
        );
        execSync('git push', { cwd: vaultPath, stdio: 'pipe' });
        console.error('[Vault] Migration committed and pushed');
      }
    } catch (e) {
      console.error('[Vault] Git commit/push failed:', e instanceof Error ? e.message : e);
    }
  }

  return result;
}

export { findPsiRepos, migrate, projectMatchesTenant, walkFiles };
export type { MigrateOptions, MigrateResult, RepoInfo };

if (import.meta.main) {
  const { runVaultMigrateCli } = await import('./migrate-cli.ts');
  runVaultMigrateCli();
}
