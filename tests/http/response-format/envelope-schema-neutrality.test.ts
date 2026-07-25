/**
 * #2821 step 1 guard — widening the ten response schemas must not change a byte
 * on the wire.
 *
 * Without this test nothing in the suite notices `success`/`data` leaking into
 * these bodies: the existing route tests assert `res.status` plus one or two
 * nested fields, never the exact top-level key set.
 */
import { describe, expect, test } from 'bun:test';
import { envelopeCases, mountBare, mountWrapped, normalize, readJson } from './_envelope-cases.ts';

describe('#2821 step 1 — envelope-widened schemas stay behaviour-neutral', () => {
  test('all ten declarations are covered', () => {
    expect(envelopeCases).toHaveLength(10);
  });

  for (const instance of envelopeCases) {
    test(`${instance.where} ${instance.method} ${instance.path} is byte-identical with and without the envelope middleware`, async () => {
      const bare = await readJson(mountBare(instance), instance);
      const wrapped = await readJson(mountWrapped(instance), instance);

      expect(wrapped.status).toBe(bare.status);
      expect(bare.status).toBe(200);
      expect(normalize(wrapped.body)).toEqual(normalize(bare.body));
    });

    test(`${instance.where} ${instance.method} ${instance.path} exposes no envelope keys at the top level`, async () => {
      const wrapped = await readJson(mountWrapped(instance), instance);
      const keys = Object.keys(wrapped.body as Record<string, unknown>);

      expect(keys).not.toContain('success');
      expect(keys).not.toContain('data');
      expect(keys.length).toBeGreaterThan(0);
    });
  }
});
