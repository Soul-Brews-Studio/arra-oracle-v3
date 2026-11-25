/**
 * GET /api/arra/topology — the live shape of a hub for the Topology view (#3110).
 *
 *   truth   the org vault (git): name, commit, last commit time. Private ψ/ notes are not here:
 *           each node indexes its own into its own .arra/ and never sends them to the hub.
 *   hub     name, port, documents it serves (hub:<name> rows only)
 *   nodes   every joined node: state, expiry, last seen, calls, refused calls since start
 *   door    strangers turned away (401) and outside callers (403) since the server started
 *   ossie   the one-way export: where it is, the in-process check, the last official validation
 *
 * Owner only (mounted under /api/arra). Read-only: building it never writes hub-state.json.
 */

import fs from 'fs';
import type { Database } from 'bun:sqlite';
import { doorLog } from './door-log.ts';
import { git, headSha, isDirty } from './git.ts';
import { listNodes } from './hub.ts';
import { ossieStatus } from './ossie-check.ts';
import { dataDir, readConfig } from './state.ts';
import { docCountsBySource } from './status.ts';

export const PRIVATE_NOTE = "Private ψ/ notes stay on each node: indexed into that node's own .arra/, never sent to the hub.";

function vaultInfo(name: string, dir: string) {
  if (!fs.existsSync(dir)) return { name, sha: null, dirty: null, committedAt: null };
  const last = git(dir, ['log', '-1', '--format=%cI'], 5_000);
  return { name, sha: headSha(dir), dirty: isDirty(dir), committedAt: last.ok ? last.out.trim() || null : null };
}

export function buildTopology(sqlite: Database, opts: { port: number | null }, dir = dataDir(), now = new Date()) {
  const config = readConfig(dir);
  const door = doorLog();
  const base = { ok: true as const, at: now.toISOString(), viewer: 'owner' as const, privateNote: PRIVATE_NOTE, ossie: ossieStatus(dir) };
  if (!config?.hub) return { ...base, hub: null, truth: null, nodes: [], door: { since: door.since, strangers: door.strangers, outside: door.outside } };
  const vault = config.vaults[0];
  const counts = docCountsBySource(sqlite);
  const nodes = listNodes(now).map((n) => ({ ...n, refused: door.refused[n.id] ?? { count: 0, lastAt: null } }));
  return {
    ...base,
    hub: { name: config.hub.name, port: opts.port, docs: counts[`hub:${vault?.name ?? config.hub.name}`] ?? 0 },
    truth: vault ? vaultInfo(vault.name, vault.path) : null,
    nodes,
    door: { since: door.since, strangers: door.strangers, outside: door.outside },
  };
}

export type Topology = ReturnType<typeof buildTopology>;
