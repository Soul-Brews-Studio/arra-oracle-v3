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
 * A crew member's ψ-brain is disabled by any of these, not just the literal "0".
 *
 * The repo's prevailing style is a bare `=== '0'`, which quietly ignores
 * `ORACLE_INDEX_CREW=false` / `=off` / `=no`. #2822 was the issue about levers that are
 * declared but do nothing, and #2846 was two more of the same shape — so a flag that only
 * honours one spelling of "off" is a known-expensive shortcut here. There are ~14 other
 * `process.env.ORACLE_* === '0'|'1'` sites that would benefit from one shared parser; that
 * is a separate change, deliberately not made here.
 *
 * Exported because `collect-vault-extras.ts` gates the *other* half of a crew brain
 * (`learn/`, `inbox/`, `outbox/`, `CLAUDE.md`) on the same lever. Two call sites reading the
 * env var with two different notions of "off" is how a documented flag starts lying.
 */
export function crewIndexingDisabled(): boolean {
  const raw = process.env.ORACLE_INDEX_CREW;
  if (raw === undefined) return false;
  return ['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}

/**
 * Discover crew ψ-brain directories in the vault.
 *
 * Scans `{repoRoot}/ψ/crew/<member>/` for members that have a `memory/` subdir, so each
 * returned path satisfies the same `{dir}/memory/{subdir}` contract as a project-first vault
 * dir and `collectDocuments` can walk it unchanged.
 *
 * Indexed by default, matching `discoverProjectPsiDirs` — crew memory is the vault's own
 * knowledge, so it follows the project-dir precedent rather than `collectSecurityCorpus`'s
 * opt-in (that one ingests a *foreign* corpus). Set `ORACLE_INDEX_CREW=0` to disable.
 *
 * Design by @Anurak112 (#2800).
 */
export function discoverCrewPsiDirs(repoRoot: string): string[] {
  const dirs: string[] = [];
  if (crewIndexingDisabled()) return dirs;

  const crewRoot = path.join(repoRoot, 'ψ', 'crew');
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
    if (fs.existsSync(path.join(memberDir, 'memory'))) dirs.push(memberDir);
  }

  if (dirs.length > 0) console.log(`Discovered ${dirs.length} crew ψ-brain directories`);
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

  // Crew ψ-brain: ψ/crew/{member}/... -> crew/{member}
  // Without this, every crew document falls through to null and lands in the same
  // unattributed bucket as root-level docs — which makes "which crew member wrote this"
  // unanswerable, and that attribution is the entire reason for indexing crew brains
  // separately. Frontmatter `project:` still wins over this (see parser.ts:21).
  const crew = relativePath.match(/^ψ\/crew\/([^/]+)\//);
  if (crew) {
    return `crew/${crew[1]}`.toLowerCase();
  }

  // Local bulk ingest: psi/learn/{org}/{repo}/... -> github.com/org/repo
  const localLearn = relativePath.match(/^ψ\/learn\/([^/]+)\/([^/]+)\//);
  if (localLearn) {
    return `github.com/${localLearn[1]}/${localLearn[2]}`.toLowerCase();
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
