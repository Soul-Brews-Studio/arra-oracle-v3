/**
 * Project discovery and path inference
 */

import fs from 'fs';
import path from 'path';

/**
 * Discover project-first psi directories in vault.
 * Scans {host}/{org}/{repo}/psi/ at repoRoot for github.com, gitlab.com, bitbucket.org.
 * Returns absolute paths to each project's psi directory.
 */
export function discoverProjectPsiDirs(repoRoot: string): string[] {
  const dirs: string[] = [];
  const hosts = ['github.com', 'gitlab.com', 'bitbucket.org'];

  for (const host of hosts) {
    const hostDir = path.join(repoRoot, host);
    if (!fs.existsSync(hostDir)) continue;

    for (const org of fs.readdirSync(hostDir)) {
      const orgDir = path.join(hostDir, org);
      if (!fs.statSync(orgDir).isDirectory()) continue;

      for (const repo of fs.readdirSync(orgDir)) {
        const psiDir = path.join(orgDir, repo, '\u03c8');
        if (fs.existsSync(psiDir) && fs.statSync(psiDir).isDirectory()) {
          dirs.push(psiDir);
        }
      }
    }
  }

  if (dirs.length > 0) {
    console.log(`Discovered ${dirs.length} project-first \u03c8/ directories`);
  }
  return dirs;
}

/**
 * Discover crew \u03c8-brain directories in vault.
 * Scans {repoRoot}/\u03c8/crew/<member>/ for dirs containing memory/.
 * Each returned dir satisfies the same {dir}/memory/{subdir} contract as
 * project-first vault dirs, so collectDocuments can walk them unchanged.
 * Set ORACLE_INDEX_CREW=0 to disable.
 */
export function discoverCrewPsiDirs(repoRoot: string): string[] {
  if (process.env.ORACLE_INDEX_CREW === '0') return [];
  const dirs: string[] = [];
  const crewRoot = path.join(repoRoot, '\u03c8', 'crew');
  if (!fs.existsSync(crewRoot)) return dirs;

  for (const member of fs.readdirSync(crewRoot)) {
    const memberDir = path.join(crewRoot, member);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(memberDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (fs.existsSync(path.join(memberDir, 'memory'))) {
      dirs.push(memberDir);
    }
  }

  if (dirs.length > 0) {
    console.log(`Discovered ${dirs.length} crew \u03c8-brain directories`);
  }
  return dirs;
}

/**
 * Infer project from a vault-nested path.
 * Project-first layout: "github.com/org/repo/psi/..." -> "github.com/org/repo"
 * Also supports legacy layout: "psi/memory/{category}/github.com/org/repo/..."
 */
export function inferProjectFromPath(relativePath: string): string | null {
  // Project-first layout: github.com/org/repo/psi/...
  const projectFirst = relativePath.match(
    /^(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+\/[^/]+)\/\u03c8\//
  );
  if (projectFirst) {
    return `${projectFirst[1]}/${projectFirst[2]}`.toLowerCase();
  }

  // Legacy layout: psi/memory/{category}/github.com/org/repo/...
  const legacy = relativePath.match(
    /^\u03c8\/(?:memory\/(?:learnings|retrospectives)|inbox\/handoff)\/(github\.com|gitlab\.com|bitbucket\.org)\/([^/]+\/[^/]+)\//
  );
  if (legacy) {
    return `${legacy[1]}/${legacy[2]}`.toLowerCase();
  }

  return null;
}
