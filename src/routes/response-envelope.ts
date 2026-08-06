import { t, type TSchema } from 'elysia';

/**
 * Widen a route `response:` schema so it ALSO accepts the `{ success, data }`
 * envelope built by src/middleware/response-format.ts. See #2821 step 1.
 *
 * ⚠️ BRANCH ORDER IS LOAD-BEARING — the original schema MUST stay first.
 * Today the middleware returns `{ success, data, ...payload }`, so the body
 * still matches the original branch and Elysia cleans it back to exactly the
 * keys the route emits today: the widening is behaviour-neutral. Put the
 * envelope branch first and every wrapped route starts emitting `{success,data}`
 * immediately, with no existing route test failing.
 * `tests/http/response-format/envelope-schema-neutrality.test.ts` is the guard.
 *
 * Widening with `t.Composite` or by adding optional `success`/`data` fields does
 * NOT work: it is not neutral (the envelope keys appear today) and it does not
 * unblock step 2 (the original required properties stay required, so an
 * envelope-only body still 422s).
 *
 * `data` is deliberately `t.Any()` rather than the payload schema. Typing it
 * would document better but would validate the payload a second time once step 2
 * lands, turning any handler/schema mismatch into a 422 instead of a silent pass.
 */
export function withEnvelope<T extends TSchema>(schema: T) {
  const envelope = t.Object({
    success: t.Boolean(),
    data: t.Optional(t.Any()),
    error: t.Optional(t.String()),
  });
  // Built via t.Union so TypeBox infers the precise static type
  // (`Static<T> | envelope`). Spreading the branches into a TSchema[] instead
  // would erase it to TSchema and Elysia would infer the handler return as
  // `never` — nine TS2345 errors across the wrapped routes.
  const union = t.Union([schema, envelope]);
  const nested = (schema as TSchema & { anyOf?: TSchema[] }).anyOf;
  if (Array.isArray(nested) && nested.length > 0) {
    // profile/index.ts:67 is already a union — flatten it so the rendered
    // OpenAPI is one anyOf, not an anyOf nested inside an anyOf. Originals
    // stay first; only `union` is mutated, never the caller's schema.
    (union as unknown as { anyOf: TSchema[] }).anyOf = [...nested, envelope];
  }
  return union;
}
