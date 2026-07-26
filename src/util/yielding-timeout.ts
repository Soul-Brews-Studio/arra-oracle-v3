/**
 * A timeout that only works against work which *yields* (#2850).
 *
 * ## What this does not do
 *
 * It does **not** protect against synchronous blocking. `setTimeout` schedules its callback on
 * the same event loop as the awaited work, so if that work blocks the loop the timer cannot
 * fire — the guard is silent in exactly the case a timeout exists to catch. It works against
 * work that is *slow but yielding*, never against work that is *stuck*.
 *
 * This is structural, not a tuning problem. No value of `timeoutMs` fixes it.
 *
 * ## Why it is named this way
 *
 * It was called `withTimeout`, in three separate copies. That name promises something the
 * implementation cannot deliver, and two real DoS bugs on 2026-07-25 proved the gap: `GET
 * /api/learn` never returned (#2836, an unbounded N+1 over `oracle_fts`, whose `id` is
 * `UNINDEXED`, so every lookup was a full scan) and `/api/memory/consolidation/suggestions`
 * pinned the server for eleven minutes (#2844). Both were invisible to an in-process
 * `Promise.race` + `setTimeout` probe. Both were caught only by an OS-level timeout in a
 * separate process.
 *
 * The name now says what it is, so a caller reaching for it can tell whether it fits.
 *
 * ## What to reach for when you need a real timeout
 *
 * Interrupting genuinely stuck work needs a separate OS process — for vector stores that is the
 * sidecar, which already exists. `tests/util/yielding-timeout.test.ts` pins the limitation with
 * a test that fails if someone "fixes" the name back.
 */

export class YieldingTimeoutError extends Error {
  constructor(timeoutMs: number, label?: string) {
    super(`${label ? `${label}: ` : ''}timed out after ${timeoutMs}ms (yielding work only)`);
    this.name = 'YieldingTimeoutError';
  }
}

/**
 * Reject if `promise` has not settled within `timeoutMs` **and the event loop is free to
 * notice**. See the module comment before relying on this for protection.
 */
export function withYieldingTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new YieldingTimeoutError(timeoutMs, label)), timeoutMs);
  });
  // Clearing the timer matters: without it a long timeout keeps the process alive after the
  // work has already settled, which is its own class of hang.
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
