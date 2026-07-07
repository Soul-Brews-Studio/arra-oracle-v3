/**
 * Shared learn-write path resolution — the single source of truth for where a
 * learning document lands on disk.
 *
 * Consumed by BOTH write paths:
 *   - HTTP handler `handleLearn` (src/server/handlers.ts, POST /api/learn)
 *   - embedded MCP tool `handleLearn` (src/tools/learn.ts, oracle_learn)
 *
 * History: these two paths carried duplicated, diverged logic — the MCP tool
 * wrote project-first `{project}/ψ/memory/learnings` under the vault while the
 * HTTP handler hardcoded flat `ψ/memory/learnings` at REPO_ROOT and ignored the
 * `project` param for the path. Result: learnings split across two roots
 * depending on transport (observed live 2026-07-06/07, 17 misplaced files).
 * Do NOT reintroduce per-path layout logic; extend this helper instead.
 */

import path from 'path';

export const LEARNINGS_SUBPATH = 'ψ/memory/learnings';

export interface LearnDirResolution {
  /** Base the write is anchored to (vault root when configured, else repoRoot). */
  baseDir: string;
  /** Directory relative to baseDir — also the prefix of the stored sourceFile. */
  relDir: string;
  /** Absolute directory to write into. */
  absDir: string;
}

/**
 * Resolve the directory a learning should be written to.
 *
 * - vault configured + project     → `{project}/ψ/memory/learnings` under the vault
 * - vault configured + no project  → `_universal/ψ/memory/learnings` under the vault
 * - vault NOT configured           → flat `ψ/memory/learnings` under repoRoot
 *   (local-ψ convention: project nesting is a vault-layout concept — see
 *   src/vault/path-mapping.ts `mapToVaultPath`)
 */
export function resolveLearnDir(opts: {
  project: string | null | undefined;
  vaultRoot: string | null;
  repoRoot: string;
}): LearnDirResolution {
  if (!opts.vaultRoot) {
    const relDir = LEARNINGS_SUBPATH;
    return { baseDir: opts.repoRoot, relDir, absDir: path.join(opts.repoRoot, relDir) };
  }
  const projectDir = (opts.project || '_universal').toLowerCase();
  const relDir = `${projectDir}/${LEARNINGS_SUBPATH}`;
  return { baseDir: opts.vaultRoot, relDir, absDir: path.join(opts.vaultRoot, relDir) };
}
