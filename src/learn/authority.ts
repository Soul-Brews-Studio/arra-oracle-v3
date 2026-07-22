import fs from 'node:fs';
import path from 'node:path';
import { detectProject } from '../server/project-detect.ts';

export type ProjectAuthority = { project: string | null } | { invalid: true };
export interface ProjectAuthorityOptions {
  explicit: boolean;
  trustedCallerCwd?: boolean;
  detectedProject?: string | null;
}

const CANONICAL_PROJECT = /^(github\.com|gitlab\.com|bitbucket\.org)\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})$/i;
const BARE_SENTINELS = new Set(['oracle-vault', 'learnings', 'unknown', '_universal']);

export function canonicalProject(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value !== value.trim() || /[\x00-\x1f\x7f%\\]/.test(value)) return null;
  if (BARE_SENTINELS.has(value.toLowerCase()) || !CANONICAL_PROJECT.test(value)) return null;
  const match = value.match(CANONICAL_PROJECT);
  if (!match) return null;
  const [, , owner, repo] = match;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  if (owner.toLowerCase().endsWith('.git') || repo.toLowerCase().endsWith('.git')) return null;
  return value.toLowerCase();
}

export function resolveProjectAuthority(
  value: unknown,
  opts: ProjectAuthorityOptions,
): ProjectAuthority {
  if (opts.explicit) {
    if (value === null) return { project: null };
    const project = canonicalProject(value);
    return project ? { project } : { invalid: true };
  }
  if (!opts.trustedCallerCwd) return { project: null };
  return { project: canonicalProject(opts.detectedProject) };
}

export function detectTrustedCallerProject(
  cwd: string | undefined,
  blockedRoots: Array<string | null | undefined>,
): { trustedCallerCwd: boolean; detectedProject: string | null } {
  if (!cwd) return { trustedCallerCwd: false, detectedProject: null };
  let realCwd: string;
  try { realCwd = fs.realpathSync(cwd); } catch { return { trustedCallerCwd: false, detectedProject: null }; }
  for (const root of blockedRoots) {
    if (!root) continue;
    let realRoot: string;
    try { realRoot = fs.realpathSync(root); } catch { realRoot = path.resolve(root); }
    if (realCwd === realRoot || realCwd.startsWith(`${realRoot}${path.sep}`)) {
      return { trustedCallerCwd: false, detectedProject: null };
    }
  }
  return { trustedCallerCwd: true, detectedProject: detectProject(realCwd) };
}
