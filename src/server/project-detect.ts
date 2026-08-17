/**
 * Project Detection via ghq/symlink resolution + git-origin fallback
 *
 * Auto-detects project context from a working directory. Three layers,
 * cheapest first; return null rather than guess a basename:
 *
 * 1. Parse host/owner/repo from the RAW input path. This must run BEFORE
 *    realpath: in a topology where the ghq path is a symlink pointing at a
 *    hostless real checkout (ghq/github.com/owner/repo -> ~/hub/repo),
 *    realpathSync erases the host segment and destroys the identity.
 * 2. Parse the resolved real path (covers the original design where the
 *    real checkout lives under ghq and the symlink is elsewhere).
 * 3. Bounded local git-origin fallback: read the containing repo's
 *    remote.origin.url with a no-network git command and parse HTTPS/SSH
 *    forms. Covers hostless real checkouts addressed directly.
 */

import fs from 'fs';
import { execFileSync } from 'node:child_process';

const HOST_PATTERN = /\/(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+\/[^/]+)/;

function matchHostPath(p: string): string | null {
  const match = p.match(HOST_PATTERN);
  if (match) {
    const [, host, ownerRepo] = match;
    return `${host}/${ownerRepo}`.toLowerCase();
  }

  // Fallback: ghq root pattern without known host, e.g. ~/Code/host/owner/repo
  const ghqMatch = p.match(/\/Code\/([^/]+\/[^/]+\/[^/]+)/);
  if (ghqMatch) return ghqMatch[1].toLowerCase();

  return null;
}

/** Parse an HTTPS or SSH git remote URL into "host/owner/repo" (lowercased). */
export function parseOriginUrl(url: string): string | null {
  const https = url.match(/^https?:\/\/([^/@]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (https) return `${https[1]}/${https[2]}/${https[3]}`.toLowerCase();

  const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}/${ssh[3]}`.toLowerCase();

  return null;
}

function detectFromGitOrigin(dir: string): string | null {
  try {
    const url = execFileSync(
      'git',
      ['-C', dir, 'config', '--get', 'remote.origin.url'],
      { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return url ? parseOriginUrl(url) : null;
  } catch {
    // not a git repo, no origin, git missing, or timeout — never guess
    return null;
  }
}

/**
 * Detect project from working directory.
 * @param cwd - Current working directory (may be a symlink path)
 * @returns Project identifier (e.g., "github.com/owner/repo") or null
 */
export function detectProject(cwd?: string): string | null {
  if (!cwd) return null;

  // 1. Raw input first — preserves ghq symlink identity
  const fromRaw = matchHostPath(cwd);
  if (fromRaw) return fromRaw;

  try {
    const realPath = fs.realpathSync(cwd);

    // 2. Resolved real path (original ghq design)
    const fromReal = matchHostPath(realPath);
    if (fromReal) return fromReal;

    // 3. Local git-origin fallback for hostless real checkouts
    return detectFromGitOrigin(realPath);
  } catch {
    // Path doesn't exist or can't be resolved
    return null;
  }
}
