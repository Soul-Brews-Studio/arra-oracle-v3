/**
 * Say something when a ranking signal is wired but has no data.
 *
 * `handleSearch` merges several signals — FTS, vectors, entity links, pointers. If one has no
 * rows, search still returns results ranked by the others, looking entirely normal.
 * `oracle_pointer_index` held **zero rows against 35,179 documents** indefinitely and nothing
 * anywhere said so (#2880).
 *
 * Fourth instance of one shape in a single night: #2806 (daemon stored an empty-string
 * embedding), #2863 (indexer queued no vector jobs), #2876 (entity boost silently skipped),
 * and this. Each time the pipeline reported success while a stage did nothing.
 *
 * Two properties this deliberately has:
 *
 * - **Once per process.** This sits on the search hot path. An unguarded `console.error` here
 *   is the ~864,000 lines/day failure `tool-alias-warn.ts` documents and #2826 shipped for
 *   real, so `warnOnce` is reused rather than reinvented.
 * - **One COUNT per process, not per request.** The check is definitive — it asks the table,
 *   rather than inferring emptiness from a query that happened to match nothing — but it runs
 *   at most once, so it cannot become a per-search cost.
 */
import type { Database } from 'bun:sqlite';
import { warnOnce } from '../config/tool-alias-warn.ts';

const checked = new Set<string>();

function count(sqlite: Database, table: string): number {
  try {
    return Number((sqlite.query(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number } | undefined)?.c ?? 0);
  } catch {
    // A missing table is itself "no data", and is not worth throwing on a search request.
    return 0;
  }
}

/**
 * Warn once if `table` is empty while the document corpus is not.
 *
 * An empty corpus is not a defect — a fresh install has no documents and every signal is
 * legitimately silent — so the corpus check is what stops this crying wolf on day one.
 *
 * Callers pass the *table* rather than a row count so the verdict is about the signal's data,
 * not about one query's luck: a query can legitimately match nothing.
 */
export function noteRankingSignalCoverage(sqlite: Database, signal: string, table: string): void {
  if (checked.has(signal)) return;
  checked.add(signal);

  if (count(sqlite, table) > 0) return;
  const corpus = count(sqlite, 'oracle_documents');
  if (corpus <= 0) return;

  warnOnce(
    `dark-signal:${signal}`,
    `[Search] ranking signal "${signal}" has 0 rows in ${table} while oracle_documents has ${corpus}. `
    + 'It is wired into search and contributes nothing. Warns once per process. See #2880.',
  );
}

/** Tests only — the guard is process-global. */
const entityBoostCounters = { applied: 0, skipped: 0 };

export function noteEntityBoostOutcome(applied: boolean): void {
  if (applied) entityBoostCounters.applied += 1;
  else entityBoostCounters.skipped += 1;
}

/**
 * A snapshot of ranking-signal outcomes since process start.
 *
 * `skipped` climbing while `applied` stays at zero is the shape of a silently dead boost — the
 * thing that was invisible in #2876 and #2878.
 */
export function rankingSignalCounters(): { entityBoost: { applied: number; skipped: number } } {
  return { entityBoost: { ...entityBoostCounters } };
}
export function resetSignalHealth(): void {
  checked.clear();
  entityBoostCounters.applied = 0;
  entityBoostCounters.skipped = 0;
}

/**
 * Cumulative outcomes for the entity boost (#2876, acceptance criterion 4).
 *
 * A *warning* would be wrong here: a query that matches no linked entity is an ordinary,
 * frequent outcome, not a defect, so warning per query would cry wolf on the search hot path.
 * What was missing is the ability to answer "is this boost ever applying?" at all — #2876 shows
 * the boost being skipped for every two-acronym query with nothing recording it, and #2878
 * shows a fix that was a no-op in production for the same reason: no counter, no signal.
 *
 * Counting is O(1) and allocation-free, so it is safe on every request.
 */
