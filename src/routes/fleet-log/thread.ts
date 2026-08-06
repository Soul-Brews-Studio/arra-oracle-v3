/**
 * `GET /api/fleet-log/thread/:key` (#2879).
 *
 * A separate endpoint rather than a `search` filter, because that is what
 * `FLEET_THREAD_CONTRACT` declares and because the ordering differs: a thread reads oldest-first
 * as a conversation, while search reads newest-first as a log.
 *
 * `thread_key` is a heuristic grouping and explicitly NOT a foreign key (see
 * `src/db/fleet-log-schema.ts:11`), so an unknown key is an empty thread, not a 404 — the same
 * answer as a thread whose messages have not been ingested yet.
 */
import { Elysia, t } from 'elysia';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { fleetMessages } from '../../db/fleet-log-schema.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import { fleetMessageSchema } from './message-schema.ts';

export function createFleetLogThreadEndpoint() {
  return new Elysia().get(
    '/fleet-log/thread/:key',
    ({ params }) => {
      const tenantId = activeTenantId();
      const rows = db
        .select()
        .from(fleetMessages)
        .where(and(eq(fleetMessages.tenantId, tenantId), eq(fleetMessages.threadKey, params.key)))
        .orderBy(asc(fleetMessages.ts))
        .all();

      return { success: true, data: { key: params.key, messages: rows, total: rows.length } };
    },
    {
      params: t.Object({ key: t.String() }),
      response: t.Object({
        success: t.Boolean(),
        error: t.Optional(t.String()),
        data: t.Optional(t.Object({
          key: t.String(),
          messages: t.Array(fleetMessageSchema()),
          total: t.Number(),
        })),
      }),
    },
  );
}
