/**
 * `fetchJson` must read either envelope shape (#2821).
 *
 * `src/middleware/response-format.ts:41` returns `{ success: true, data: response, ...response }`
 * — every field twice, once nested and once spread at top level. The spread is a transitional
 * shim from #1777 that was never removed, and every caller in this file reads the top-level copy.
 *
 * Removing it backend-side is the actual fix, but it would make those reads silently
 * `undefined`: `fetchJson` ends in `payload as T`, and a cast is not a check — tsc sees nothing
 * and no test fails until a page renders blank. #2821 calls this out and says the backend and
 * frontend changes must land together or the frontend breaks silently.
 *
 * This is the half that carries no risk. Teaching the frontend to prefer `data` first means the
 * backend cleanup afterwards cannot break it, whichever shape arrives — so the breaking change
 * stops being breaking.
 */
import { describe, expect, test } from 'bun:test';
import { unwrapEnvelope } from '../../../frontend/src/pages/vectorSettingsHelpers';

describe('the current double-shaped envelope', () => {
  test('nested fields are returned', () => {
    const payload = { success: true, data: { engine: 'lancedb', enabled: true }, engine: 'lancedb', enabled: true };
    expect(unwrapEnvelope(payload)).toMatchObject({ engine: 'lancedb', enabled: true });
  });
});

describe('the post-cleanup shape, with no top-level spread', () => {
  test('fields are still found under data', () => {
    // This is what the backend returns once `...response` is dropped. Today it would make
    // every caller read undefined.
    const payload = { success: true, data: { engine: 'qdrant', enabled: false } };
    expect(unwrapEnvelope(payload)).toMatchObject({ engine: 'qdrant', enabled: false });
  });

  test('a nested array field survives', () => {
    const payload = { success: true, data: { services: [{ name: 'a' }, { name: 'b' }] } };
    expect((unwrapEnvelope(payload) as { services: unknown[] }).services).toHaveLength(2);
  });

  test('nested wins over a stale top-level copy', () => {
    // During the transition both exist. The nested one is the copy that survives.
    const payload = { success: true, data: { engine: 'new' }, engine: 'stale' };
    expect(unwrapEnvelope(payload)).toMatchObject({ engine: 'new' });
  });
});

describe('it does not unwrap things that are not envelopes', () => {
  test('a payload with its own data field but no success is left alone', () => {
    // A legitimate response whose domain model happens to include `data`.
    const payload = { data: { rows: 3 }, total: 1 };
    expect(unwrapEnvelope(payload)).toEqual(payload);
  });

  test('a null data field is left alone', () => {
    const payload = { success: true, data: null };
    expect(unwrapEnvelope(payload)).toEqual(payload);
  });

  test('a scalar data field is left alone', () => {
    // `{ success: true, data: 5 }` must not be spread — there is nothing to spread.
    const payload = { success: true, data: 5 };
    expect(unwrapEnvelope(payload)).toEqual(payload);
  });

  test('a bare array is returned unchanged', () => {
    expect(unwrapEnvelope([1, 2, 3])).toEqual([1, 2, 3]);
  });

  test('null and non-objects pass through', () => {
    expect(unwrapEnvelope(null)).toBeNull();
    expect(unwrapEnvelope('text')).toBe('text');
  });
});

describe('envelope keys stay reachable', () => {
  test('success is preserved alongside the unwrapped fields', () => {
    // Some callers check `success`; unwrapping must not hide it.
    expect(unwrapEnvelope({ success: true, data: { a: 1 } })).toMatchObject({ success: true, a: 1 });
  });
});
