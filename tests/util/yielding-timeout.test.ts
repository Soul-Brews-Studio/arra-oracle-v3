/**
 * `withYieldingTimeout` works on yielding work and is blind to synchronous blocking (#2850).
 *
 * The blindness is the point of these tests. It is a real property of `Promise.race` +
 * `setTimeout` — the timer shares the event loop it is supposed to police — and the decision on
 * #2850 was to name and document that rather than pretend otherwise. A test that only proved
 * the happy path would leave the next person free to rename it back to `withTimeout` and rely
 * on it for protection it cannot give.
 *
 * Two real DoS bugs on 2026-07-25 were invisible to exactly this shape of probe: `GET
 * /api/learn` never returning (#2836) and `/api/memory/consolidation/suggestions` pinning the
 * server for eleven minutes (#2844). Both were caught only by an OS-level timeout in a separate
 * process.
 */
import { describe, expect, test } from 'bun:test';
import { withYieldingTimeout, YieldingTimeoutError } from '../../src/util/yielding-timeout.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Occupies the event loop for real — no awaits, nothing to yield to. */
function blockSynchronously(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* deliberately spinning */ }
}

describe('it does what it claims: yielding work', () => {
  test('slow-but-yielding work is rejected', async () => {
    await expect(withYieldingTimeout(sleep(400), 30)).rejects.toThrow(YieldingTimeoutError);
  });

  test('work that finishes in time resolves with its value', async () => {
    await expect(withYieldingTimeout(sleep(1).then(() => 'ok'), 500)).resolves.toBe('ok');
  });

  test('the error names the budget and the label, so a log line is diagnosable', async () => {
    const err = await withYieldingTimeout(sleep(400), 25, 'getStats').catch((e: Error) => e);
    expect(err.message).toContain('25ms');
    expect(err.message).toContain('getStats');
  });

  test('a rejection from the work itself passes through unchanged', async () => {
    const boom = Promise.reject(new Error('store unreachable'));
    await expect(withYieldingTimeout(boom, 500)).rejects.toThrow('store unreachable');
  });
});

describe('it is blind to synchronous blocking — this is the documented limitation', () => {
  test('a synchronously blocking operation is NOT interrupted', async () => {
    /**
     * The timer is scheduled for 20ms, the work blocks for 250ms. If the guard could interrupt
     * synchronous blocking, this would reject at ~20ms. It cannot: the callback is queued
     * behind the block, so the work completes first and the timeout loses the race.
     *
     * If this test ever starts failing, the implementation gained a real capability and the
     * module comment — and the name — are now understating it. That is a good failure, but it
     * must be a deliberate one.
     */
    const started = Date.now();
    const result = await withYieldingTimeout(
      (async () => { blockSynchronously(250); return 'finished anyway'; })(),
      20,
    );
    const elapsed = Date.now() - started;

    expect(result).toBe('finished anyway');
    // It ran to completion despite a 20ms budget.
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  test('no value of the timeout changes that', async () => {
    // Not a tuning problem: 1ms is as blind as 20ms.
    const result = await withYieldingTimeout(
      (async () => { blockSynchronously(150); return 'still finished'; })(),
      1,
    );
    expect(result).toBe('still finished');
  });
});

describe('the timer does not outlive the work', () => {
  test('a long budget does not keep a settled call pending', async () => {
    // Without clearTimeout, a 30s budget holds a timer for 30s after the work is done — a hang
    // of its own kind at process exit.
    const started = Date.now();
    await withYieldingTimeout(Promise.resolve('fast'), 30_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
