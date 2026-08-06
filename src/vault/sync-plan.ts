/**
 * Builds the write/delete plan for a vault sync, and refuses to build one that syncs a repo
 * into itself.
 *
 * `resolveVaultPath()` is a **ghq query**, not a path resolver: it returns the repository ROOT
 * for `owner/repo`. So setting `vault_repo` to the repo you are working in resolves the vault to
 * that same checkout, and `mapToVaultPath` then appends `<project>/ψ/…` beneath it. The sync
 * would copy the whole of `ψ/` into a nested `<repo>/<project>/ψ/` tree, and `syncVault` would
 * follow that with `git add -A`, `git commit` and `git push` (handler.ts) **in the working
 * repository** — sweeping up any unrelated uncommitted state and pushing it.
 *
 * `.gitignore`'s `ψ/` pattern matches at any depth, so the copied tree is invisible to
 * `git status` and would accumulate silently. That is what makes this worth a hard failure
 * rather than a warning: the destructive part is the commit-and-push, and the evidence that
 * something went wrong is hidden by design.
 *
 * `migrate.ts` has a superficially similar check, but it exists to *exclude* the vault repo from
 * a migration source list — it does not detect this case.
 */
import fs from 'fs';
import path from 'path';
import { walkFiles } from './discovery.ts';
import { mapToVaultPath, ensureFrontmatterProject, isProjectCategory } from './path-mapping.ts';

export type SyncWriteOp = { source: string; dest: string; content?: string };
export type SyncDeleteOp = { path: string; stopAt: string };
export type SyncPlan = {
  writes: SyncWriteOp[];
  deletes: SyncDeleteOp[];
  added: number;
  modified: number;
  deleted: number;
};

/** True when `candidate` resolves to `dir` itself or anything beneath it. */
function isInside(dir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Refuse a vault that is the source repository, or contains it. Either direction means the sync
 * would write into the tree it is reading from and then commit and push that tree.
 */
export function assertVaultIsNotSelf(vaultPath: string, repoRoot: string): void {
  if (!isInside(vaultPath, repoRoot) && !isInside(repoRoot, vaultPath)) return;
  throw new Error(
    `Refusing to sync a repository into itself.\n` +
      `  vault path = ${vaultPath}\n` +
      `  source repo = ${repoRoot}\n` +
      `vault_repo resolves through ghq to a repository ROOT, so pointing it at this checkout ` +
      `would copy ψ/ into a nested tree here and then run 'git add -A', 'git commit' and ` +
      `'git push' in this repository. Point vault_repo at a separate vault repository.`,
  );
}

function sameFileContent(dest: string, source: string, content?: string): boolean {
  if (!fs.existsSync(dest)) return false;
  if (content !== undefined) return fs.readFileSync(dest, 'utf-8') === content;
  return fs.readFileSync(dest).equals(fs.readFileSync(source));
}

export function planSync(
  psiDir: string,
  repoRoot: string,
  vaultPath: string,
  project: string | null,
): SyncPlan {
  assertVaultIsNotSelf(vaultPath, repoRoot);

  const diskFiles = walkFiles(psiDir, repoRoot);
  const vaultDestPaths = new Set<string>();
  const writes: SyncWriteOp[] = [];
  const deletes: SyncDeleteOp[] = [];
  let added = 0;
  let modified = 0;

  for (const { relativePath, fullPath } of diskFiles) {
    const vaultRelPath = mapToVaultPath(relativePath, project);
    vaultDestPaths.add(vaultRelPath);
    const dest = path.join(vaultPath, vaultRelPath);
    const content = project && fullPath.endsWith('.md') && isProjectCategory(relativePath)
      ? ensureFrontmatterProject(fs.readFileSync(fullPath, 'utf-8'), project)
      : undefined;

    if (!sameFileContent(dest, fullPath, content)) {
      fs.existsSync(dest) ? modified++ : added++;
      writes.push({ source: fullPath, dest, content });
    }
  }

  // Clean up vault files that no longer exist locally
  if (project) {
    const vaultProjectDir = path.join(vaultPath, project, 'ψ');
    if (fs.existsSync(vaultProjectDir)) {
      for (const { relativePath: vr, fullPath: vf } of walkFiles(vaultProjectDir, vaultPath)) {
        if (!vaultDestPaths.has(vr)) deletes.push({ path: vf, stopAt: path.join(vaultPath, project) });
      }
    }
  }
  return { writes, deletes, added, modified, deleted: deletes.length };
}
