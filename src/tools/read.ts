/**
 * Oracle Read Handler
 *
 * Read full document content by file path or document ID.
 * Resolves vault paths, ghq paths, and symlinks server-side.
 */

import fs from 'fs';
import path from 'path';
import { getVaultPsiRoot } from '../vault/handler.ts';
import type { ToolContext, ToolResponse, OracleReadInput } from './types.ts';

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
function extractProject(filePath: string): { project: string; remainder: string } | null {
  const match = filePath.match(/^(github\.com\/[^/]+\/[^/]+)\/(.*)/);
  if (match) return { project: match[1], remainder: match[2] };
  return null;
}

/**
 * Try to resolve a source_file path to a readable absolute path.
 * Returns the absolute path if found, null otherwise.
 */
function resolveFilePath(
  sourceFile: string,
  repoRoot: string,
  ghqRoot: string,
): string | null {
  // 1. Try direct from repoRoot (handles "ψ/memory/..." paths)
  const directPath = path.join(repoRoot, sourceFile);
  if (fs.existsSync(directPath)) return fs.realpathSync(directPath);

  // 2. Try ghq project path (handles "github.com/org/repo/ψ/..." paths)
  const extracted = extractProject(sourceFile);
  if (extracted) {
    const projectPath = path.join(ghqRoot, extracted.project, extracted.remainder);
    if (fs.existsSync(projectPath)) return fs.realpathSync(projectPath);
  }

  // 3. Try vault fallback
  const vault = getVaultPsiRoot();
  if ('path' in vault) {
    const vaultPath = path.join(vault.path, sourceFile);
    if (fs.existsSync(vaultPath)) return fs.realpathSync(vaultPath);
  }

  return null;
}

/** Security check: verify resolved path is within allowed roots */
function isPathAllowed(resolvedPath: string, repoRoot: string, ghqRoot: string): boolean {
  try {
    const realGhq = fs.realpathSync(ghqRoot);
    if (resolvedPath.startsWith(realGhq)) return true;
  } catch { /* ghq root may not exist */ }

  try {
    const realRepo = fs.realpathSync(repoRoot);
    if (resolvedPath.startsWith(realRepo)) return true;
  } catch { /* unlikely */ }

  return false;
}

export async function handleRead(ctx: ToolContext, input: OracleReadInput): Promise<ToolResponse> {
  const { file, id } = input;

  if (!file && !id) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'Provide file or id parameter' }) }],
      isError: true,
    };
  }

  let sourceFile = file;
  let project: string | null = null;

  // ID lookup: resolve source_file from DB
  if (id) {
    const row = ctx.sqlite.prepare(
      'SELECT source_file, project FROM oracle_documents WHERE id = ?'
    ).get(id) as { source_file: string; project: string | null } | null;

    if (!row) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Document not found: ${id}` }) }],
        isError: true,
      };
    }
    sourceFile = sourceFile || row.source_file;
    project = row.project;
  }

  const ghqRoot = detectGhqRoot(ctx.repoRoot);
  const resolvedPath = resolveFilePath(sourceFile!, ctx.repoRoot, ghqRoot);

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
