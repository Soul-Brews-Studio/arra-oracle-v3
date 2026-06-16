/** GET /api/file — cross-repo file read with path-traversal guard.
 *
 * Defense layers:
 *   1. TypeBox pattern on `path` (see model.ts) rejects "..", null-byte
 *   2. Handler re-checks explicitly so we return the canonical 400 JSON
 *      shape on traversal attempts instead of Elysia's 422 validator body
 *   3. `realpathSync` + `.startsWith(realRoot)` confines resolution
 */
import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { getVaultPsiRoot } from '../../vault/handler.ts';
import { fileQuery } from './model.ts';
import { projectAllowedForTenant } from './tenant.ts';

const currentRepoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;

export const fileRoute = new Elysia().get(
  '/api/file',
  ({ query, set }) => {
    const filePath = query.path;
    const project = query.project;

    if (!filePath) {
      set.status = 400;
      return { error: 'Missing path parameter' };
    }

    if (project && !projectAllowedForTenant(project)) {
      return new Response('File not found', { status: 404 });
    }

    // SECURITY: Block path traversal attempts (belt-and-suspenders with TypeBox pattern).
    if (filePath.includes('..') || filePath.includes('\0')) {
      set.status = 400;
      return { error: 'Invalid path: traversal not allowed' };
    }

    try {
      // Detect GHQ_ROOT dynamically (no hardcoding).
      let GHQ_ROOT = process.env.GHQ_ROOT;
      if (!GHQ_ROOT) {
        try {
          const proc = Bun.spawnSync(['ghq', 'root']);
          GHQ_ROOT = proc.stdout.toString().trim();
        } catch {
          const root = currentRepoRoot();
          const match = root.match(/^(.+?)\/github\.com\//);
          GHQ_ROOT = match
            ? match[1]
            : path.dirname(path.dirname(path.dirname(root)));
        }
      }
      const root = currentRepoRoot();
      const basePath = project ? path.join(GHQ_ROOT, project) : root;

      // Strip project prefix if source_file already contains it.
      let resolvedFilePath = filePath;
      if (
        project &&
        filePath.toLowerCase().startsWith(project.toLowerCase() + '/')
      ) {
        resolvedFilePath = filePath.slice(project.length + 1);
      }
      const fullPath = path.join(basePath, resolvedFilePath);
      let realPath: string;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        realPath = path.resolve(fullPath);
      }

      const realGhqRoot = fs.realpathSync(GHQ_ROOT);
      const realRepoRoot = fs.realpathSync(root);
      if (
        !realPath.startsWith(realGhqRoot) &&
        !realPath.startsWith(realRepoRoot)
      ) {
        set.status = 400;
        return { error: 'Invalid path: outside allowed bounds' };
      }

      if (fs.existsSync(fullPath)) {
        return new Response(fs.readFileSync(fullPath, 'utf-8'));
      }

      // Fallback: some files carry a project frontmatter tag but physically
      // live in the universal vault (REPO_ROOT / ORACLE_DATA_DIR / ψ/), not
      // in the project's ghq checkout. Try REPO_ROOT before giving up.
      if (project) {
        const repoFullPath = path.join(root, filePath);
        const realRepoFullPath = path.resolve(repoFullPath);
        if (
          realRepoFullPath.startsWith(realRepoRoot) &&
          fs.existsSync(repoFullPath)
        ) {
          return new Response(fs.readFileSync(repoFullPath, 'utf-8'));
        }
      }

      const vault = getVaultPsiRoot();
      if ('path' in vault) {
        const vaultFullPath = path.join(vault.path, filePath);
        const realVaultPath = path.resolve(vaultFullPath);
        const realVaultRoot = fs.realpathSync(vault.path);
        if (
          realVaultPath.startsWith(realVaultRoot) &&
          fs.existsSync(vaultFullPath)
        ) {
          return new Response(fs.readFileSync(vaultFullPath, 'utf-8'));
        }
      }

      return new Response('File not found', { status: 404 });
    } catch (e: any) {
      return new Response(e.message, { status: 500 });
    }
  },
  {
    query: fileQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'hidden' },
      summary: 'Cross-repo file read with traversal guard',
    },
  },
);
