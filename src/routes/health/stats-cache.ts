/**
 * Short-lived cache for `GET /api/stats`.
 *
 * The route does live work on every call — a tenant-scoped document count, an
 * FTS health read, an embedder runtime probe, and a per-engine vector stats
 * fetch. The Studio calls it on every page load, and Elysia is single-threaded,
 * so each call occupies the only loop there is.
 *
 * It was NOT the cause of the 2026-07-25 wedge — that was
 * `/api/memory/consolidation/suggestions` (#2843), and `/api/stats` merely
 * queued behind it and looked guilty in the log. This is defence in depth: the
 * exposure is real regardless of who blocked the loop that day.
 *
 * Deliberately small: a TTL, an in-flight promise so a burst collapses into one
 * computation, and nothing else. No LRU, no invalidation hooks — stats are a
 * dashboard read, and a few seconds of staleness costs nothing.
 */

export const DEFAULT_STATS_TTL_MS = 5_000;

function ttlFrom(env: Record<string, string | undefined>): number {
  const raw = env.ORACLE_STATS_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_STATS_TTL_MS;
  const parsed = Number(raw);
  // 0 is a legitimate value: it disables caching. Only reject nonsense.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STATS_TTL_MS;
}

export type StatsCache<T> = {
  get(compute: () => Promise<T>): Promise<T>;
  clear(): void;
};

export function createStatsCache<T>(options: {
  ttlMs?: number;
  env?: Record<string, string | undefined>;
  now?: () => number;
} = {}): StatsCache<T> {
  const ttlMs = options.ttlMs ?? ttlFrom(options.env ?? process.env);
  const now = options.now ?? Date.now;

  let value: T | undefined;
  let storedAt = -Infinity;
  let inFlight: Promise<T> | null = null;

  return {
    async get(compute: () => Promise<T>): Promise<T> {
      if (ttlMs > 0 && value !== undefined && now() - storedAt < ttlMs) return value;
      // Collapse a burst: N concurrent callers do ONE computation, not N. This is
      // the part that matters on a single-threaded server — a dashboard opening
      // several panels at once used to mean several full probes.
      if (inFlight) return inFlight;

      inFlight = compute()
        .then((next) => {
          value = next;
          storedAt = now();
          return next;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },

    clear(): void {
      value = undefined;
      storedAt = -Infinity;
      inFlight = null;
    },
  };
}
