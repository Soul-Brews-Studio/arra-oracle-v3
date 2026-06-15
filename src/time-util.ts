/**
 * Time helpers — Oracle fleet standard timezone is GMT+7 (Asia/Bangkok).
 *
 * Doc ids / filenames must stamp the LOCAL Thai calendar date, not UTC. A write at
 * 00:30 Bangkok is still the *previous* day in UTC, so `new Date().toISOString()`
 * mis-dated ids (e.g. a 2026-06-15 00:06 ICT learning got id `learning_2026-06-14_…`),
 * which fooled date-based corpus checks fleet-wide. (TK timezone-standardization 2026-06-15)
 *
 * Thailand is a fixed UTC+7 offset (no DST), so shifting the instant by +7h and taking
 * the UTC date part yields the exact Bangkok calendar date with no Intl/tz-data dependency.
 *
 * Note: stored timestamps (createdAt/updatedAt) stay as `Date.now()` epoch-ms — those are
 * absolute instants and timezone-neutral; only the human-readable date STRING needs GMT+7.
 */
export function bangkokDateStr(d: Date = new Date()): string {
  return new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
}
