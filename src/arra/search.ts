/**
 * Grouped search: results come back per SOURCE — `self`, then one group per `hub:<name>` —
 * each ranked on its own. Scores are comparable only inside a group (a hub's rows may come from
 * another embedder, or FTS only), so nothing is merged or re-ranked across groups.
 *
 *   "q"          every source        "self:q"   only this arra's own memory
 *   "shared:q"   only hub:<name> rows (what sync brought in)
 *
 * Purely local: hub rows are the synced cache, so a hub that is down never breaks search.
 * Each joined hub gets a note (last sync, expired) instead.
 */

import type { Database } from 'bun:sqlite';
import { handleSearch } from '../server/handlers.ts';
import { buildFtsQuery } from '../server/handlers.ts';
import { isExpired, readHubs } from './state.ts';
import { embedderInfo, SELF, sourceOf } from './status.ts';

export type Scope = 'all' | 'self' | 'shared';
export interface Hit { n: number; id: string; title: string; score: number; snippet: string; source_file: string }
export interface Group { source: string; ranking: string; results: Hit[] }

export function parseScope(raw: string): { scope: Scope; query: string } {
  const m = raw.trim().match(/^(self|shared):\s*(.*)$/i);
  return m ? { scope: m[1].toLowerCase() as Scope, query: m[2].trim() } : { scope: 'all', query: raw.trim() };
}

const titleOf = (content: string, file: string) =>
  (content.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() || file).slice(0, 90);
const snippetOf = (content: string) => content.replace(/\s+/g, ' ').trim().slice(0, 160);

async function selfGroup(sqlite: Database, query: string, limit: number): Promise<Group> {
  const res = await handleSearch(query, 'all', limit * 3, 0, 'hybrid');
  const ids = res.results.map((r) => r.id);
  const origins = new Map<string, string | null>();
  if (ids.length) {
    const rows = sqlite.query(`SELECT id, origin FROM oracle_documents WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: string; origin: string | null }>;
    for (const row of rows) origins.set(row.id, row.origin);
  }
  const mine = res.results.filter((r) => sourceOf(origins.get(r.id)) === SELF).slice(0, limit);
  return {
    source: SELF,
    ranking: res.vectorAvailable ? `hybrid (${embedderInfo().model})` : 'fts',
    results: mine.map((r, i) => ({ n: i + 1, id: r.id, title: titleOf(r.content, r.source_file), score: Number((r.score ?? 0).toFixed(4)), snippet: snippetOf(r.content), source_file: r.source_file })),
  };
}

function hubGroups(sqlite: Database, query: string, limit: number): Group[] {
  const fts = buildFtsQuery(query);
  if (!fts) return [];
  const rows = sqlite.query(`
    SELECT d.id, d.origin, d.source_file, f.content, bm25(oracle_fts) AS rank
      FROM oracle_fts f JOIN oracle_documents d ON d.id = f.id
     WHERE oracle_fts MATCH ? AND d.origin LIKE 'hub:%' AND d.superseded_by IS NULL
     ORDER BY rank LIMIT ?`).all(fts, limit * 20) as Array<{ id: string; origin: string; source_file: string; content: string; rank: number }>;
  const groups = new Map<string, Hit[]>();
  for (const row of rows) {
    const hits = groups.get(row.origin) ?? [];
    if (hits.length >= limit) continue;
    hits.push({ n: hits.length + 1, id: row.id, title: titleOf(row.content, row.source_file), score: Number((-row.rank).toFixed(4)), snippet: snippetOf(row.content), source_file: row.source_file });
    groups.set(row.origin, hits);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, results]) => ({ source, ranking: 'fts (bm25)', results }));
}

export async function groupedSearch(sqlite: Database, raw: string, limit = 10) {
  const { scope, query } = parseScope(raw);
  if (!query) throw new Error('empty query');
  const groups: Group[] = [];
  if (scope !== 'shared') groups.push(await selfGroup(sqlite, query, limit));
  if (scope !== 'self') groups.push(...hubGroups(sqlite, query, limit));
  const notes = scope === 'self' ? [] : readHubs().map((h) =>
    isExpired(h.expiresAt) ? `hub:${h.name} expired ${h.expiresAt}: rows shown are the last sync (${h.lastSyncAt ?? 'never'})`
      : `hub:${h.name} last sync ${h.lastSyncAt ?? 'never'}`);
  return {
    query, scope,
    total: groups.reduce((n, g) => n + g.results.length, 0),
    groups,
    notes: [...notes, 'scores compare only within a group'],
  };
}

/** One document by id: this arra's own copy (self or synced hub row). */
export function readLocal(sqlite: Database, id: string) {
  const doc = sqlite.query('SELECT id, type, source_file, origin, created_by, concepts, superseded_by FROM oracle_documents WHERE id = ?').get(id) as
    { id: string; type: string; source_file: string; origin: string | null; created_by: string | null; concepts: string; superseded_by: string | null } | null;
  if (!doc) return null;
  const fts = sqlite.query('SELECT content FROM oracle_fts WHERE id = ?').get(id) as { content: string } | null;
  const content = fts?.content ?? '';
  return { id: doc.id, source: sourceOf(doc.origin), type: doc.type, title: titleOf(content, doc.source_file), source_file: doc.source_file,
    created_by: doc.created_by, superseded_by: doc.superseded_by, content };
}
