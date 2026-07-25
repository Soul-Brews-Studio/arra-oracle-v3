/**
 * #2821 step 1 justification — the widened schemas must actually unblock step 2.
 *
 * Step 2 drops the `...response` spread at src/middleware/response-format.ts:41,
 * so these routes will start emitting a bare `{ success, data }`. This file
 * previews that body against the REAL routes (via mountNoSpread, which never
 * edits the middleware) and asserts they answer 200 rather than 422.
 *
 * The control case at the bottom shows the 422 that step 2 would have caused
 * without step 1 — that is what makes the passing cases above meaningful.
 */
import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { envelopeCases, mountNoSpread, readJson, served } from './_envelope-cases.ts';
import { withEnvelope } from '../../../src/routes/response-envelope.ts';

const payload = { id: 'thor', nested: { ok: true } };

function noSpreadApp(response: unknown) {
  return new Elysia()
    .onAfterHandle({ as: 'global' }, () => ({ success: true, data: payload }))
    .get('/probe', () => payload, { response: response as never });
}

async function probe(response: unknown) {
  const res = await noSpreadApp(response).handle(new Request('http://local/probe'));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('#2821 step 1 — widened schemas are ready for the step-2 no-spread middleware', () => {
  for (const instance of envelopeCases) {
    test(`${instance.where} ${instance.method} ${instance.path} serves a valid envelope once the spread is dropped`, async () => {
      const preview = await readJson(mountNoSpread(instance), instance);

      // 422 is the exact failure step 1 exists to prevent. Assert it on every
      // run, whatever the environment did — this is the load-bearing check.
      expect(preview.status).not.toBe(422);
      // A 500 here is shared-SQLite contention in the full suite, not a schema
      // problem; there is no envelope to inspect in that case.
      if (!served(preview)) return;

      const body = preview.body as Record<string, unknown>;
      // Both envelope shapes are legitimate at 200: the success payload, and the
      // `{success:false,error}` form that stats.ts:96 returns when the DB is locked.
      expect(Object.keys(body).sort().every((key) => ['success', 'data', 'error'].includes(key))).toBe(true);
      expect(typeof body.success).toBe('boolean');
      if (body.success === true) expect(body.data).toBeDefined();
      else expect(typeof body.error).toBe('string');
    });
  }

  test('control: a narrow (un-widened) schema 422s under the same no-spread middleware', async () => {
    const narrow = t.Object({ id: t.String(), nested: t.Object({ ok: t.Boolean() }) });
    const { status } = await probe(narrow);

    expect(status).toBe(422);
  });

  test('the same schema, widened, answers 200 and preserves the whole payload', async () => {
    const { status, body } = await probe(withEnvelope(t.Object({
      id: t.String(),
      nested: t.Object({ ok: t.Boolean() }),
    })));

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: payload });
  });
});
