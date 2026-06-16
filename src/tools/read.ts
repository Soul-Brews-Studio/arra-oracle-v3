/**
 * Oracle Read Handler
 *
 * Read full document content by file path or document ID.
 * Resolves vault paths, ghq paths, and symlinks server-side.
 */

import fs from 'fs';
import path from 'path';
import type { ToolContext, ToolResponse, OracleReadInput } from './types.ts';
import { currentTenantId } from '../middleware/tenant.ts';

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

/** Detect GHQ_ROOT — same logic as /api/file in server.ts */
function detectGhqRoot(repoRoot: string): string {
  let ghqRoot = process.env.GHQ_ROOT;
  if (!ghqRoot) {
    try {
      const proc = Bun.spawnSync(['ghq', 'root']);
      ghqRoot = proc.stdout.toString().trim();
    } catch {
      const match = repoRoot.match(/^(.+?)\/github\.com\//);
      ghqRoot = match ? match[1] : path.dirname(path.dirname(path.dirname(repoRoot)));
    }
  }
  return ghqRoot;
}

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
): Promise<string | null> {
  // 1. Try direct from repoRoot (handles "ψ/memory/..." paths)
  const directPath = existingPathInside(repoRoot, sourceFile);
  if (directPath) return directPath;

  // 2. Try ghq project path (handles "github.com/org/repo/ψ/..." paths)
  const extracted = extractProject(sourceFile);
  if (extracted) {
    const projectPath = existingPathInside(ghqRoot, path.join(extracted.project, extracted.remainder));
    if (projectPath) return projectPath;
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
function isPathAllowed(resolvedPath: string, repoRoot: string, ghqRoot: string): boolean {
  try {
    const realGhq = fs.realpathSync(ghqRoot);
    if (isWithinPath(resolvedPath, realGhq)) return true;
  } catch { /* ghq root may not exist */ }

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

  const sourceProject = project ?? (sourceFile ? extractProject(sourceFile)?.project ?? null : null);
  if (tenantId && sourceProject && !projectMatchesTenant(sourceProject, tenantId)) {
    return notFound(id || sourceFile || 'file');
  }

  const ghqRoot = detectGhqRoot(ctx.repoRoot);
  const resolvedPath = await resolveFilePath(sourceFile!, ctx.repoRoot, ghqRoot);

  // File found on disk
  if (resolvedPath && isPathAllowed(resolvedPath, ctx.repoRoot, ghqRoot)) {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
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

  // Fallback: try FTS indexed content (if we have an id)
  if (id) {
    const ftsRow = ctx.sqlite.prepare(
      'SELECT content FROM oracle_fts WHERE id = ?'
    ).get(id) as { content: string } | null;

    if (ftsRow) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            content: ftsRow.content,
            source_file: sourceFile,
            resolved_path: null,
            source: 'fts_cache',
            ...(project ? { project } : {}),
          }),
        }],
      };
    }
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
