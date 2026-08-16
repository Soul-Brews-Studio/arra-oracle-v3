/**
 * No corpus is an ordinary state, not an error.
 *
 * Most machines will never run `just export-turso`, so the session tools must report
 * `available: false` with a reason that names the fix — and must not throw, must not create the
 * file, and must not take the rest of the Oracle down with them. CI itself is such a machine:
 * these tests are the only coverage that runs where /opt/data/.lens does not exist.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'lens-absent-'));
const ORIGINAL = process.env.ORACLE_LENS_DB;

beforeAll(() => { /* each test sets ORACLE_LENS_DB itself */ });

afterAll(async () => {
  if (ORIGINAL) process.env.ORACLE_LENS_DB = ORIGINAL;
  else delete process.env.ORACLE_LENS_DB;
  (await import('../lens.ts')).resetLens();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('a missing corpus degrades rather than throwing', () => {
  test('lensStatus reports unavailable and names how to produce one', async () => {
    const missing = join(TMP, 'nope.db');
    process.env.ORACLE_LENS_DB = missing;
    const { lensStatus, resetLens } = await import('../lens.ts');
    resetLens();

    const status = lensStatus();
    expect(status.available).toBe(false);
    expect(status.path).toBe(missing);
    expect(status.reason).toContain('export-turso');   // actionable, not just "not found"
    expect(existsSync(missing)).toBe(false);           // status must not create it
  });

  test('every query returns available:false with empty results, never throws', async () => {
    process.env.ORACLE_LENS_DB = join(TMP, 'still-nope.db');
    const { resetLens } = await import('../lens.ts');
    resetLens();
    const { beatsForSession, beatsInRange, searchBeats, listSessions } = await import('../query.ts');

    expect(beatsForSession('any')).toEqual({ available: false, beats: [] });
    expect(searchBeats('any')).toEqual({ available: false, beats: [] });
    expect(beatsInRange('2026-01-01', '2026-12-31')).toEqual({ available: false, beats: [] });
    expect(listSessions()).toEqual({ available: false, sessions: [] });
  });

  test('a file that exists but is not a lens export is rejected, not half-read', async () => {
    const bogus = join(TMP, 'not-a-lens.db');
    writeFileSync(bogus, 'this is not sqlite');
    process.env.ORACLE_LENS_DB = bogus;
    const { lensStatus, resetLens } = await import('../lens.ts');
    resetLens();

    const status = lensStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  test('the MCP tools surface the reason instead of failing opaquely', async () => {
    process.env.ORACLE_LENS_DB = join(TMP, 'absent-for-tools.db');
    const { resetLens } = await import('../lens.ts');
    resetLens();
    const { handleSessionSearch, handleSessionList } = await import('../../tools/sessions.ts');
    const ctx = {} as Parameters<typeof handleSessionList>[0];

    for (const res of [
      await handleSessionList(ctx, {}),
      await handleSessionSearch(ctx, { query: 'anything' }),
    ]) {
      expect(res.isError).toBe(true);
      const payload = JSON.parse(res.content[0]!.text) as { success: boolean; available: boolean; reason?: string };
      expect(payload.success).toBe(false);
      expect(payload.available).toBe(false);
      expect(payload.reason).toContain('export-turso');
    }
  });

  test('a missing required argument is rejected before the corpus is even consulted', async () => {
    const { handleSessionGet, handleSessionSearch } = await import('../../tools/sessions.ts');
    const ctx = {} as Parameters<typeof handleSessionGet>[0];

    const noId = await handleSessionGet(ctx, {});
    expect(noId.isError).toBe(true);
    expect(JSON.parse(noId.content[0]!.text).error).toContain('sessionId');

    const noQuery = await handleSessionSearch(ctx, { query: '   ' });
    expect(noQuery.isError).toBe(true);
    expect(JSON.parse(noQuery.content[0]!.text).error).toContain('query');
  });
});
