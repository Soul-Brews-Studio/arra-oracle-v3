/**
 * ⚠️ SKIPPED — this file has not been able to *load* since #2332, and CI never noticed.
 *
 * It imports `serveCommandPlan` from `src/cli/commands/serve.ts`, which exports only
 * `serveCommand`. The import throws `SyntaxError: Export named 'serveCommandPlan' not found`
 * before a single test runs, so the whole file counts as one unhandled error.
 *
 * It is not a broken import to repair: the assertions describe a design that no longer
 * exists. They expect a pure planner returning `{ kind: 'delegate', args: [...] }` — an
 * entrypoint that forwards to a separate binary. #2332 ("consolidate serve cli entrypoint")
 * removed that indirection; `serveCommand` now dispatches directly to `runServerStart` /
 * `runServerStatus` / `runServerStop`. Restoring the export would mean restoring the
 * architecture it tested.
 *
 * Invisible until now because CI ran a hand-maintained list of 183 files that excluded
 * `tests/cli/` — see #2853, which is what surfaced this.
 *
 * Left in place, skipped, rather than deleted: whether the delegate design should return, or
 * these assertions should be rewritten against `serveCommand`, is a call for whoever owns the
 * CLI. The original body is preserved below and in git history.
 */
import { describe, expect, test } from 'bun:test';

describe.skip('serve command plan (obsolete — see the note above)', () => {
  test('placeholder so the skip is visible in test output', () => {
    expect(true).toBe(true);
  });
});

/* Original assertions, against the removed `serveCommandPlan`:
describe('serve command adapter', () => {
  test('delegates default start to canonical serve CLI', () => {
    expect(serveCommandPlan(['serve'])).toEqual({ kind: 'delegate', args: [] });
    expect(serveCommandPlan(['serve', 'daemon', '--port', '5999'])).toEqual({
      kind: 'delegate',
      args: ['start', '--port', '5999'],
    });
  });

  test('keeps status and stop arguments intact', () => {
    expect(serveCommandPlan(['serve', 'status', '--json'])).toEqual({ kind: 'delegate', args: ['status', '--json'] });
    expect(serveCommandPlan(['serve', 'stop', '--port', '5999'])).toEqual({ kind: 'delegate', args: ['stop', '--port', '5999'] });
  });

  test('preserves foreground-only mode outside the canonical background CLI', () => {
    expect(serveCommandPlan(['serve', 'foreground'])).toEqual({ kind: 'foreground' });
    expect(serveCommandPlan(['serve', 'start', '--foreground'])).toEqual({ kind: 'foreground' });
  });

  test('rejects conflicting start mode flags before delegation', () => {
    expect(serveCommandPlan(['serve', 'start', '--foreground', '--background'])).toEqual({
      kind: 'error',
      message: 'Cannot use --foreground and --background together',
    });
  });
});
*/
