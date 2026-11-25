/**
 * Spaces (#3110, Nat 2026-11-25): the Studio header picks which notes every page shows.
 *   self          this machine's own memory (origin not hub:*)
 *   hub:<name>    one hub's shared notes, as synced in (or, on the hub itself, its vault)
 * A space is a filter over the one local database, not a tenant: tenants are separate oracles.
 */
import type { Database } from 'bun:sqlite';
import { readConfig, readHubs, isExpired } from './state.ts';
import { docCountsBySource, SELF, sourceOf } from './status.ts';

export type Space = 'self' | `hub:${string}`;
export interface SpaceInfo { id: Space; label: string; docs: number; role: 'self' | 'owner' | 'joined'; hub?: string; expired?: boolean }

const HUB = /^hub:[A-Za-z0-9._-]{1,80}$/;

export function parseSpace(raw: string | null | undefined): Space | null {
  const s = raw?.trim();
  if (!s || s === 'all') return null;
  if (s === SELF) return SELF;
  if (HUB.test(s)) return s as Space;
  throw new Error(`space must be "self" or "hub:<name>", got "${s}"`);
}

/** Keep only rows whose document belongs to `space`. Rows without an id are dropped. */
export function filterBySpace<T extends { id?: string }>(sqlite: Database, rows: T[], space: Space): T[] {
  const ids = rows.map((r) => r.id).filter((x): x is string => !!x);
  if (!ids.length) return [];
  const found = sqlite.query(`SELECT id, origin FROM oracle_documents WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: string; origin: string | null }>;
  const origin = new Map(found.map((r) => [r.id, r.origin]));
  return rows.filter((r) => r.id && origin.has(r.id) && sourceOf(origin.get(r.id)) === space);
}

/** Every space this arra can show: itself, the hub it owns (if any), and each hub it joined. */
export function listSpaces(sqlite: Database, dir?: string): SpaceInfo[] {
  const counts = docCountsBySource(sqlite);
  const config = readConfig(dir);
  const ownVault = config?.hub ? `hub:${config.vaults[0]?.name ?? ''}` : null;
  const spaces: SpaceInfo[] = [{ id: SELF, label: 'This machine', docs: counts[SELF] ?? 0, role: 'self' }];
  const seen = new Set<string>([SELF]);
  if (config?.hub && ownVault) {
    spaces.push({ id: ownVault as Space, label: `hub:${config.hub.name}`, docs: counts[ownVault] ?? 0, role: 'owner', hub: config.hub.name });
    seen.add(ownVault);
  }
  for (const h of readHubs(dir)) {
    const id = `hub:${h.name}` as Space;
    if (seen.has(id)) continue;
    spaces.push({ id, label: id, docs: counts[id] ?? 0, role: 'joined', hub: h.name, expired: isExpired(h.expiresAt) });
    seen.add(id);
  }
  for (const [id, n] of Object.entries(counts)) {
    if (!seen.has(id)) spaces.push({ id: id as Space, label: id, docs: n, role: 'joined', hub: id.slice(4) });
  }
  return spaces;
}
