/**
 * Fail-closed authority gate for the indexer's destructive smart-delete phase.
 *
 * Nothing in the DB proves which repoRoot owns a row: `project` is
 * caller-controlled metadata (frontmatter can stamp any value) and
 * ORACLE_REPO_ROOT is an override. Deletion is therefore denied unless an
 * explicitly configured `canonical_source_root` setting resolves to the same
 * real path as the running repoRoot AND the caller confirms the exact planned
 * delete count. No production code path writes that setting.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';

export const CANONICAL_SOURCE_ROOT_KEY = 'canonical_source_root';

export interface DeletePlanRow {
  id: string;
  sourceFile: string;
  project: string | null;
}

export interface DeletePlan {
  rows: DeletePlanRow[];
  hasNullProject: boolean;
  byProject: Map<string, number>;
  bySourcePrefix: Map<string, number>;
}

/**
 * Normalized first 3 path components of a source file, so the printed plan
 * reveals which source scope the candidates came from (e.g.
 * "ψ/memory/retrospectives") before an operator confirms a count.
 */
export function sourcePrefix(sourceFile: string): string {
  const parts = sourceFile.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return '(unknown)';
  return parts.slice(0, 3).join('/');
}

export function buildDeletePlan(rows: DeletePlanRow[]): DeletePlan {
  const byProject = new Map<string, number>();
  const bySourcePrefix = new Map<string, number>();
  let hasNullProject = false;
  for (const row of rows) {
    const key = row.project?.trim() || '(null)';
    if (key === '(null)') hasNullProject = true;
    byProject.set(key, (byProject.get(key) ?? 0) + 1);
    const prefix = sourcePrefix(row.sourceFile);
    bySourcePrefix.set(prefix, (bySourcePrefix.get(prefix) ?? 0) + 1);
  }
  return { rows, hasNullProject, byProject, bySourcePrefix };
}

function printBreakdown(label: string, counts: Map<string, number>): void {
  console.log(label);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sorted) {
    console.log(`  ${key}: ${count}`);
  }
}

export function printDeletePlan(plan: DeletePlan): void {
  if (plan.rows.length === 0) {
    console.log('Smart-delete plan: 0 stale candidates');
    return;
  }
  printBreakdown(`Smart-delete plan: ${plan.rows.length} stale candidate(s) by project:`, plan.byProject);
  printBreakdown('Smart-delete plan by source prefix:', plan.bySourcePrefix);
}

function realpathOrNull(p: string | null | undefined): string | null {
  if (!p?.trim()) return null;
  try {
    return fs.realpathSync(path.resolve(p.trim()));
  } catch {
    return null;
  }
}

export interface PruneAuthority {
  granted: boolean;
  reason: string;
}

export function resolvePruneAuthority(args: {
  sqlite: Database;
  repoRoot: string;
  confirmDelete: number | undefined;
  plan: DeletePlan;
}): PruneAuthority {
  const deny = (reason: string): PruneAuthority => ({ granted: false, reason });

  let canonical: string | null;
  try {
    const row = args.sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(CANONICAL_SOURCE_ROOT_KEY) as { value: string | null } | null;
    canonical = row?.value ?? null;
  } catch {
    return deny('settings table unreadable');
  }
  if (!canonical?.trim()) return deny(`no ${CANONICAL_SOURCE_ROOT_KEY} configured`);

  // Fail-closed: an unresolvable path on either side denies; a shared null can
  // never compare equal into a grant.
  const canonicalReal = realpathOrNull(canonical);
  if (canonicalReal === null) return deny(`${CANONICAL_SOURCE_ROOT_KEY} does not resolve to a real path`);
  const repoReal = realpathOrNull(args.repoRoot);
  if (repoReal === null) return deny('repoRoot does not resolve to a real path');
  if (canonicalReal !== repoReal) {
    return deny(`repoRoot ${repoReal} is not the canonical source root ${canonicalReal}`);
  }
  if (!fs.existsSync(path.join(canonicalReal, 'ψ', 'memory'))) {
    return deny('canonical source root has no ψ/memory');
  }
  if (args.plan.hasNullProject) {
    return deny('plan touches NULL-project rows (prune disabled pending provenance repair)');
  }
  if (args.confirmDelete === undefined) {
    return deny(`destructive prune requires --confirm-delete=${args.plan.rows.length} (exact planned count)`);
  }
  if (args.confirmDelete !== args.plan.rows.length) {
    return deny(`--confirm-delete=${args.confirmDelete} does not match planned count ${args.plan.rows.length}`);
  }
  return { granted: true, reason: 'canonical source root verified + exact-count confirmation' };
}
