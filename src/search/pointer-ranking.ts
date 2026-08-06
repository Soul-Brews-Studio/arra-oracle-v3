/**
 * Ranking and read-path bounds for the pointer signal (#2880).
 *
 * Bounds how many documents the pointer signal hydrates per query.
 *
 * `hydratePointerDocs` used to pass **every** matched document id into
 * `inArray(oracleDocuments.id, ids)`, joined onto the FTS table, fetching them all before
 * applying the limit in JS. That was invisible while `oracle_pointer_index` was empty — `ids`
 * was always `[]` — which is exactly why it survived: the table this signal reads had zero rows
 * for its whole life.
 *
 * Populating it exposes the cost. Measured on the real corpus after backfill, a single query
 * took **over 120 seconds**: the pointer `entity|oracle` alone lists 11,840 documents, and
 * `date|2026` lists 34,614 — 98% of the corpus. A ranking signal that has to read most of the
 * corpus to rank anything is worse than one that is dark.
 *
 * The ranking is already computed before hydration, so the cheapest correct fix is to hydrate
 * only the best candidates. The cap is generous relative to `limit` because SQL-side filters
 * (`type`, `project`) are applied *after* this truncation — too tight a cap and a filtered
 * query would come back short. Ties are broken by id so the choice is deterministic rather
 * than dependent on Map insertion order.
 */

/** Hydrate at most this many documents, however many the pointers matched. */
export const HYDRATION_FLOOR = 200;
export const HYDRATION_MULTIPLIER = 10;

export function hydrationCap(limit: number): number {
  return Math.max(HYDRATION_FLOOR, Math.trunc(limit) * HYDRATION_MULTIPLIER);
}

/**
 * The highest-scoring document ids, capped. Returns every id when the match set is already
 * within the cap, so ordinary queries are unaffected.
 */
export function topRankedIds(
  ranked: Map<string, { score: number; matches: string[] }>,
  limit: number,
): string[] {
  const cap = hydrationCap(limit);
  if (ranked.size <= cap) return [...ranked.keys()];
  return [...ranked.entries()]
    .sort((a, b) => (b[1].score - a[1].score) || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([id]) => id);
}

/**
 * A pointer listing more documents than this is treated as noise and skipped.
 *
 * Classic IDF reasoning: a key that matches a third of the corpus does not discriminate between
 * documents, so the work of reading it cannot change the ranking. Measured on the real corpus
 * after backfill, the worst offenders are exactly the useless ones — `date|2026` lists 34,614
 * documents (98%), `date|2026-06` 29,837, `entity|oracle` 11,840. Parsing those JSON arrays was
 * most of the remaining query time once hydration was capped.
 */
export const MAX_POINTER_DOCS = 5_000;

/**
 * Estimate how many ids a `doc_ids` JSON array holds without parsing it.
 *
 * The parse is the cost being avoided, so this counts separators instead — O(n) over the string
 * with no allocation, against JSON.parse building a 34,614-element array.
 */
export function estimateIdCount(docIdsJson: string): number {
  if (!docIdsJson || docIdsJson.length <= 2) return 0;
  let count = 1;
  for (let i = 0; i < docIdsJson.length; i += 1) if (docIdsJson.charCodeAt(i) === 44) count += 1;
  return count;
}

/** True when a pointer is too common to carry ranking signal. */
export function tooCommonToRank(docIdsJson: string): boolean {
  return estimateIdCount(docIdsJson) > MAX_POINTER_DOCS;
}

type PointerKind = 'topic' | 'entity' | 'date';
export type PointerRankInput = { kind: PointerKind; key: string; label: string };
type PointerRankRow = { kind: PointerKind; key: string; docIds: string };

const KIND_WEIGHT: Record<PointerKind, number> = { entity: 0.55, topic: 0.35, date: 0.25 };

export function parseIds(raw: string | undefined): string[] {
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}

export function rankDocs(
  rows: PointerRankRow[],
  wanted: PointerRankInput[],
): Map<string, { score: number; matches: string[] }> {
  const wantedLabels = new Map(wanted.map((item) => [`${item.kind}:${item.key}`, item.label]));
  const ranked = new Map<string, { score: number; matches: string[] }>();
  for (const row of rows) {
    // A key matching a third of the corpus cannot change the ranking — skip before parsing.
    if (tooCommonToRank(row.docIds)) continue;
    const label = wantedLabels.get(`${row.kind}:${row.key}`) ?? row.key;
    for (const docId of parseIds(row.docIds)) {
      const hit = ranked.get(docId) ?? { score: 0, matches: [] };
      hit.score += KIND_WEIGHT[row.kind];
      if (!hit.matches.includes(label)) hit.matches.push(label);
      ranked.set(docId, hit);
    }
  }
  return ranked;
}

export function conceptValues(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return raw.split(',').map((item) => item.trim()).filter(Boolean); }
}
export function dateKeys(timestamp: number | undefined): string[] {
  if (!timestamp || !Number.isFinite(timestamp)) return [];
  const iso = new Date(timestamp).toISOString();
  return [iso.slice(0, 4), iso.slice(0, 7), iso.slice(0, 10)];
}
export function dateKeysFromText(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(/\b(19\d{2}|20\d{2})(?:[-/](0?[1-9]|1[0-2])(?:[-/](0?[1-9]|[12]\d|3[01]))?)?\b/g)) {
    const [, year, month, day] = match;
    keys.add(year);
    if (month) keys.add(`${year}-${month.padStart(2, '0')}`);
    if (month && day) keys.add(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  }
  return [...keys];
}
export function clamp(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value.toFixed(6)))) : 0; }
