/**
 * `arra status` / GET /api/arra/status — what this arra is, where its data lives, what it holds.
 *
 * Counts documents per SOURCE: `self` for this node's own memory, `hub:<name>` for rows a sync
 * brought in from a shared vault. That split is the same one grouped search uses.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { resolveEmbeddingModel, resolveEmbeddingProviderSelection } from '../vector/embedder-config.ts';
import { headSha, isDirty } from './git.ts';
import { dataDir, isExpired, publicHub, readConfig, readHubs, readHubState } from './state.ts';
import { currentTenantId } from '../middleware/tenant.ts';

export const SELF = 'self';

/** `hub:<name>` for synced shared rows, otherwise `self`. */
export function sourceOf(origin: string | null | undefined): string {
  return origin && origin.startsWith('hub:') ? origin : SELF;
}

export function embedderInfo() {
  const sel = resolveEmbeddingProviderSelection();
  const model = resolveEmbeddingModel() ?? (sel.provider === 'none' ? 'none' : `${sel.provider}-default`);
  return { provider: sel.provider, model, url: process.env.ORACLE_EMBEDDER_URL?.trim() || null };
}

/** Docs per source for ONE tenant (the request's, else default): other oracles hosted here are not "self". */
export function docCountsBySource(sqlite: Database, tenantId: string = currentTenantId() ?? 'default'): Record<string, number> {
  const rows = sqlite.query(
    `SELECT CASE WHEN origin LIKE 'hub:%' THEN origin ELSE 'self' END AS source, count(*) AS n
       FROM oracle_documents WHERE superseded_by IS NULL AND COALESCE(tenant_id, 'default') = ?
      GROUP BY source ORDER BY source`,
  ).all(tenantId) as Array<{ source: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.source, r.n]));
}

export function listSnapshots(dir = dataDir()): Array<{ file: string; bytes: number }> {
  const snapDir = path.join(dir, 'snapshots');
  if (!fs.existsSync(snapDir)) return [];
  return fs.readdirSync(snapDir)
    .filter((f) => f.endsWith('.tar.zst') || f.endsWith('.tar.gz'))
    .sort()
    .map((file) => ({ file, bytes: fs.statSync(path.join(snapDir, file)).size }));
}

export function buildStatus(sqlite: Database, dir = dataDir()) {
  const config = readConfig(dir);
  const state = readHubState(dir);
  const bySource = docCountsBySource(sqlite);
  const now = new Date();
  return {
    ok: true,
    initialized: !!config,
    name: config?.name ?? null,
    dataDir: dir,
    dbPath: process.env.ORACLE_DB_PATH?.trim() || path.join(dir, 'oracle.db'),
    repoRoot: process.env.ORACLE_REPO_ROOT?.trim() || null,
    docs: { total: Object.values(bySource).reduce((a, b) => a + b, 0), bySource },
    embedder: embedderInfo(),
    vaults: (config?.vaults ?? []).map((v) => ({
      ...v,
      exists: fs.existsSync(v.path),
      sha: fs.existsSync(v.path) ? headSha(v.path) : null,
      dirty: fs.existsSync(v.path) ? isDirty(v.path) : null,
    })),
    hubs: readHubs(dir).map(publicHub),
    hub: config?.hub
      ? {
          name: config.hub.name,
          vault: config.hub.vault ?? null,
          nodes: state.nodes.filter((n) => n.status === 'active' && !isExpired(n.expiresAt, now)).length,
          invitesOpen: state.invites.filter((i) => !i.usedAt && !isExpired(i.codeExpiresAt, now)).length,
        }
      : null,
    snapshots: listSnapshots(dir),
  };
}
