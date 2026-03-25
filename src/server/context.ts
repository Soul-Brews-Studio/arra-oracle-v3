/**
 * Arra Oracle v3 Project Context
 * Detects project context from ghq-format directory paths
 */

import { execSync } from 'child_process';

export interface ProjectContext {
  // From ghq path parsing
  github: string;      // "https://github.com/laris-co/arra-oracle"
  owner: string;       // "laris-co"
  repo: string;        // "arra-oracle"
  ghqPath: string;     // "github.com/laris-co/arra-oracle"

  // Directories
  root: string;        // Git root directory
  cwd: string;         // Current working directory

  // Git state
  branch: string;      // Current branch
  worktree: string;    // Git worktree path
}

/**
 * Parse ghq-format path to extract GitHub project info
 * e.g., ~/Code/github.com/owner/repo/src
 *    -> github.com/owner/repo
 */
export function parseGhqPath(path: string): { owner: string; repo: string; ghqPath: string } | null {
  // Match github.com/owner/repo pattern anywhere in the path
  const match = path.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (match) {
    return {
      owner: match[1],
      repo: match[2],
      ghqPath: `github.com/${match[1]}/${match[2]}`,
    };
  }
  return null;
}

/**
 * Get git information for a directory
 */
export function getGitInfo(cwd: string): { root: string; branch: string; worktree: string } | null {
  try {
    const root = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
    const worktree = execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8' }).trim();

    return { root, branch, worktree };
  } catch {
    return null;
  }
}

/**
 * Get full project context from a directory path
 * Combines ghq path parsing with git info
 */
export function getProjectContext(cwd: string): ProjectContext | null {
  const ghqInfo = parseGhqPath(cwd);
  if (!ghqInfo) {
    return null;
  }

  const gitInfo = getGitInfo(cwd);

  return {
    github: `https://github.com/${ghqInfo.owner}/${ghqInfo.repo}`,
    owner: ghqInfo.owner,
    repo: ghqInfo.repo,
    ghqPath: ghqInfo.ghqPath,
    root: gitInfo?.root || cwd,
    cwd: cwd,
    branch: gitInfo?.branch || 'unknown',
    worktree: gitInfo?.worktree || cwd,
  };
}

/**
 * Handle /context HTTP request
 * Query params:
 *   - cwd: Current working directory (optional, defaults to ORACLE_CWD or process.cwd())
 */
export function handleContext(cwdParam?: string): ProjectContext | { error: string } {
  const cwd = cwdParam || process.env.ORACLE_CWD || process.cwd();

  const context = getProjectContext(cwd);
  if (!context) {
    return {
      error: 'Could not detect project context. Path must contain github.com/owner/repo pattern.',
    };
  }

  return context;
}
