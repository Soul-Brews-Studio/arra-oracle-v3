/**
 * Oracle Read Handler
 *
 * Read full document content by file path or document ID.
 * Resolves vault paths, ghq paths, and symlinks server-side.
 */

import fs from 'fs';
import { recordReadAccess } from './read-access-log.ts';
import path from 'path';
import type { ToolContext, ToolResponse, OracleReadInput } from './types.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { detectGhqRoot } from '../util/ghq-root.ts';

let getVaultPsiRootFn: typeof import('../vault/handler.ts').getVaultPsiRoot | null = null;
async function loadGetVaultPsiRoot(): Promise<typeof import('../vault/handler.ts').getVaultPsiRoot> {
  if (!getVaultPsiRootFn) {
    getVaultPsiRootFn = (await import('../vault/handler.ts')).getVaultPsiRoot;
  }
  return getVaultPsiRootFn;
}

export const readToolDef = {
  name: 'oracle_read',
  description: 'Read full content of an Oracle document by file path or document ID. Use after oracle_search to retrieve complete file contents. Resolves vault paths, ghq paths, and symlinks server-side.',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Source file path from search results (e.g., "ψ/memory/learnings/file.md" or "github.com/org/repo/ψ/...")',
      },
      id: {
        type: 'string',
        description: 'Document ID from oracle_search results. Looks up source_file from DB.',
      },
    },
  },
};

/** Extract ghq-style project prefix from a source_file path */

function projectMatchesTenant(project: string, tenantId: string): boolean {
  const normalizedProject = project.trim().toLowerCase();
  const tenant = tenantId.trim().toLowerCase();
  if (!tenant || normalizedProject === tenant) return true;
  return normalizedProject.split(/[\/]+/).filter(Boolean).includes(tenant);
}

function notFound(idOrFile: string): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: `Document not found: ${idOrFile}` }) }],
    isError: true,
  };
}

function usageError(): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: 'Provide file or id parameter' }) }],
    isError: true,
  };
}

function inputString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function extractProject(filePath: string): { project: string; remainder: string } | null {
  const match = filePath.match(/^(github\.com\/[^/]+\/[^/]+)\/(.*)/);
  if (match) return { project: match[1], remainder: match[2] };
  return null;
}

function tenantPathOwner(filePath: string): string | null {
  const parts = filePath.split(/[\\/]+/);
  const index = parts.findIndex((part, i) => part === 'tenants' && parts[i - 1] === 'ψ');
  return index >= 0 ? parts[index + 1] ?? null : null;
}

function isWithinPath(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function existingPathInside(root: string, relativePath: string): string | null {
  try {
    const realRoot = fs.realpathSync(root);
    const candidate = path.resolve(realRoot, relativePath);
    if (!isWithinPath(candidate, realRoot) || !fs.existsSync(candidate)) return null;
    const realCandidate = fs.realpathSync(candidate);
    return isWithinPath(realCandidate, realRoot) ? realCandidate : null;
  } catch {
    return null;
  }
}

/**
 * Try to resolve a source_file path to a readable absolute path.
 * Returns the absolute path if found, null otherwise.
 */
async function resolveFilePath(
  sourceFile: string,
  repoRoot: string,
  ghqRoot: string,
  project?: string | null,
): Promise<string | null> {
  // 1. Try direct from repoRoot (handles "ψ/memory/..." paths)
  const directPath = existingPathInside(repoRoot, sourceFile);
  if (directPath) return directPath;

  // 1.5 Try the document's DB project column via the ghq mapping. Retro/learning
  // docs store source_file relative to their own repo; the ghq entry for that
  // project may be a symlink into agent-hub, so accept the symlink's real target.
  if (project) {
    try {
      const joined = path.resolve(ghqRoot, project, sourceFile);
      if (isWithinPath(joined, fs.realpathSync(ghqRoot)) && fs.existsSync(joined)) {
        return fs.realpathSync(joined);
      }
    } catch { /* fall through */ }
  }

  // 2. Try ghq project path (handles "github.com/org/repo/ψ/..." paths). Like
  // step 1.5, the ghq entry may be a symlink into agent-hub — resolve to its
  // real target and let the caller's isPathAllowed() judge the boundary.
  const extracted = extractProject(sourceFile);
  if (extracted) {
    try {
      const joined = path.resolve(ghqRoot, extracted.project, extracted.remainder);
      if (isWithinPath(joined, fs.realpathSync(ghqRoot)) && fs.existsSync(joined)) {
        return fs.realpathSync(joined);
      }
    } catch { /* fall through */ }
  }

  // 3. Try vault fallback
  const getVaultPsiRoot = await loadGetVaultPsiRoot();
  const vault = getVaultPsiRoot();
  if ('path' in vault) {
    const vaultPath = existingPathInside(vault.path, sourceFile);
    if (vaultPath) return vaultPath;
  }

  return null;
}

/** Security check: verify resolved path is within allowed roots */
export function isPathAllowed(resolvedPath: string, repoRoot: string, ghqRoot: string, project?: string | null): boolean {
  let realGhq: string | null = null;
  try {
    realGhq = fs.realpathSync(ghqRoot);
    if (isWithinPath(resolvedPath, realGhq)) return true;
  } catch { /* ghq root may not exist */ }

  // agent-hub is where the machine's ghq project symlinks legitimately point
  // (see INFRA-MAP); a path that entered via a ghq mapping resolves here.
  try {
    const realHub = fs.realpathSync(path.join(process.env.HOME || '', 'tt3p', 'agent-hub'));
    if (isWithinPath(resolvedPath, realHub)) return true;
  } catch { /* hub may not exist on other installs */ }

  // A ghq project entry can be a symlink to any location on this machine, not
  // only agent-hub (e.g. vault/<repo>). Resolve exactly that one first-level
  // project entry — the same entry resolveFilePath already followed to reach
  // resolvedPath — and allow paths within ITS realpath only. The pre-realpath
  // join must stay inside ghqRoot, mirroring resolveFilePath's own guard, so a
  // crafted project value can't walk the check outside the ghq tree.
  if (project && realGhq) {
    try {
      // Resolve against realGhq (not the raw ghqRoot) so the containment
      // check compares two paths through the same symlink resolution — else
      // an OS-level symlink earlier in ghqRoot's own path (e.g. macOS's
      // /var -> /private/var) can make a legitimate join look "outside".
      const projectRoot = path.resolve(realGhq, project);
      if (isWithinPath(projectRoot, realGhq)) {
        const realProjectRoot = fs.realpathSync(projectRoot);
        if (isWithinPath(resolvedPath, realProjectRoot)) return true;
      }
    } catch { /* project entry may not exist */ }
  }

  try {
    const realRepo = fs.realpathSync(repoRoot);
    if (isWithinPath(resolvedPath, realRepo)) return true;
  } catch { /* unlikely */ }

  return false;
}

export async function handleRead(ctx: ToolContext, input: OracleReadInput): Promise<ToolResponse> {
  if (input == null || typeof input !== 'object') return usageError();
  const { file: rawFile, id: rawId } = input as { file?: unknown; id?: unknown };
  const file = inputString(rawFile);
  const id = inputString(rawId);

  if (!file && !id) {
    return usageError();
  }

  let sourceFile = file;
  let project: string | null = null;
  const tenantId = currentTenantId();

  // ID lookup: resolve source_file from DB
  if (id) {
    const row = tenantId
      ? ctx.sqlite.prepare('SELECT source_file, project FROM oracle_documents WHERE id = ? AND tenant_id = ?')
        .get(id, tenantId) as { source_file: string; project: string | null } | null
      : ctx.sqlite.prepare('SELECT source_file, project FROM oracle_documents WHERE id = ?')
        .get(id) as { source_file: string; project: string | null } | null;

    if (!row) return notFound(id);
    sourceFile = sourceFile || row.source_file;
    project = row.project;
  }

  // Search results expose source_file and project as separate fields, while the
  // documented follow-up call commonly passes only the exact source_file. When
  // that relative path belongs to one active DB project, recover the project so
  // the same search result can resolve through its ghq checkout. Do not guess
  // when the relative path is shared by multiple projects; callers can use id.
  if (sourceFile && !project) {
    const rows = tenantId
      ? ctx.sqlite.prepare(`
          SELECT DISTINCT project FROM oracle_documents
          WHERE source_file = ? AND tenant_id = ? AND superseded_by IS NULL
            AND project IS NOT NULL AND trim(project) != ''
          LIMIT 2
        `).all(sourceFile, tenantId) as Array<{ project: string }>
      : ctx.sqlite.prepare(`
          SELECT DISTINCT project FROM oracle_documents
          WHERE source_file = ? AND superseded_by IS NULL
            AND project IS NOT NULL AND trim(project) != ''
          LIMIT 2
        `).all(sourceFile) as Array<{ project: string }>;
    if (rows.length === 1) project = rows[0].project;
  }

  const sourceProject = project ?? (sourceFile ? extractProject(sourceFile)?.project ?? null : null);
  if (tenantId && sourceProject && !projectMatchesTenant(sourceProject, tenantId)) {
    return notFound(id || sourceFile || 'file');
  }
  const pathTenant = tenantId && sourceFile ? tenantPathOwner(sourceFile) : null;
  if (tenantId && pathTenant && pathTenant !== tenantId) return notFound(id || sourceFile || 'file');

  const ghqRoot = detectGhqRoot(ctx.repoRoot);
  const resolvedPath = await resolveFilePath(sourceFile!, ctx.repoRoot, ghqRoot, project ?? sourceProject);

  // File found on disk
  if (resolvedPath && isPathAllowed(resolvedPath, ctx.repoRoot, ghqRoot, project ?? sourceProject)) {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    await recordReadAccess(ctx, id, sourceFile, sourceProject);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          content,
          source_file: sourceFile,
          resolved_path: resolvedPath,
          source: 'file',
          ...(project ? { project } : {}),
        }),
      }],
    };
  }

  // Fallback: indexed content remains a valid, explicitly labelled cache when
  // the source file moved or disappeared. This must also work for the exact
  // source_file returned by oracle_search, not only when the caller copied id.
  const ftsRow: { id: string; content: string; project?: string | null } | null = id
    ? ctx.sqlite.prepare('SELECT id, content FROM oracle_fts WHERE id = ?')
      .get(id) as { id: string; content: string } | null
    : tenantId
      ? ctx.sqlite.prepare(`
          SELECT d.id, f.content, d.project
          FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id
          WHERE d.source_file = ? AND d.tenant_id = ? AND d.superseded_by IS NULL
          ORDER BY CASE WHEN d.id LIKE '%__chunk_%' THEN 1 ELSE 0 END, d.updated_at DESC
          LIMIT 1
        `).get(sourceFile!, tenantId) as { id: string; content: string; project: string | null } | null
      : ctx.sqlite.prepare(`
          SELECT d.id, f.content, d.project
          FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id
          WHERE d.source_file = ? AND d.superseded_by IS NULL
          ORDER BY CASE WHEN d.id LIKE '%__chunk_%' THEN 1 ELSE 0 END, d.updated_at DESC
          LIMIT 1
        `).get(sourceFile!) as { id: string; content: string; project: string | null } | null;

  if (ftsRow) {
    const cachedProject = project ?? ftsRow.project ?? null;
    await recordReadAccess(ctx, ftsRow.id, sourceFile, cachedProject);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          content: ftsRow.content,
          document_id: ftsRow.id,
          source_file: sourceFile,
          resolved_path: null,
          source: 'fts_cache',
          ...(cachedProject ? { project: cachedProject } : {}),
        }),
      }],
    };
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: `File not found: ${sourceFile}`,
        source_file: sourceFile,
        ...(project ? { project } : {}),
      }),
    }],
    isError: true,
  };
}
