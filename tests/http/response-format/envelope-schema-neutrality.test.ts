/**
 * #2821 step 1 guard — widening the ten response schemas must not change a byte
 * on the wire.
 *
 * Without this test nothing in the suite notices `success`/`data` leaking into
 * these bodies: the existing route tests assert `res.status` plus one or two
 * nested fields, never the exact top-level key set.
 *
 * The core assertion is bare-vs-wrapped equality, which holds at ANY status — so
 * it still runs when the shared SQLite file is contended and the DB-backed
 * routes answer 500 (see `served`). A schema-driven break would be a 422, and
 * that is asserted against unconditionally.
 */
import { describe, expect, test } from 'bun:test';
import { envelopeCases, mountBare, mountWrapped, normalize, readJson, served } from './_envelope-cases.ts';

describe('#2821 step 1 — envelope-widened schemas stay behaviour-neutral', () => {
  test('all ten declarations are covered', () => {
    expect(envelopeCases).toHaveLength(10);
  });

  for (const instance of envelopeCases) {
    test(`${instance.where} ${instance.method} ${instance.path} is byte-identical with and without the envelope middleware`, async () => {
      const bare = await readJson(mountBare(instance), instance);
      const wrapped = await readJson(mountWrapped(instance), instance);

      expect(wrapped.status).toBe(bare.status);
      expect(wrapped.parsed).toBe(bare.parsed);
      if (!bare.parsed) {
        // Environment could not serve the route (e.g. SQLite "disk I/O error").
        // Neutrality still holds: the envelope middleware changed nothing.
        expect(wrapped.text).toBe(bare.text);
        return;
      }
      expect(normalize(wrapped.body)).toEqual(normalize(bare.body));
    });

    test(`${instance.where} ${instance.method} ${instance.path} exposes no envelope keys at the top level`, async () => {
      const bare = await readJson(mountBare(instance), instance);
      const wrapped = await readJson(mountWrapped(instance), instance);

      // A schema-driven regression shows up as 422; anything else is environmental.
      expect(wrapped.status).not.toBe(422);
      if (!served(bare)) {
        expect(wrapped.status).toBe(bare.status);
        return;
      }

      expect(wrapped.status).toBe(200);
      const keys = Object.keys(wrapped.body as Record<string, unknown>);
      expect(keys).not.toContain('success');
      expect(keys).not.toContain('data');
      expect(keys.length).toBeGreaterThan(0);
    });
  }
});
