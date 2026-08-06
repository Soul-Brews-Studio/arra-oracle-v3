/**
 * `GET /api/fleet-log/search` (#2879).
 *
 * Matches the string `frontend/src/pages/fleetLogMock.ts` has been declaring while the page
 * rendered fixtures:
 *
 *   GET /api/fleet-log/search?query=&channel=&from=&to=&since=&until=
 *
 * Ordered newest-first, which is what a log console wants and what
 * `idx_fleet_msg_tenant_ts` is built for.
 */
import { Elysia, t } from 'elysia';
import { desc, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { fleetMessages } from '../../db/fleet-log-schema.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import {
  buildFleetWhere,
  FleetFilterError,
  parsePagination,
  type FleetSearchQuery,
} from './filters.ts';
import { fleetMessageSchema } from './message-schema.ts';

export function createFleetLogSearchEndpoint() {
  return new Elysia().get(
    '/fleet-log/search',
    ({ query, set }) => {
      const tenantId = activeTenantId();
      let where;
      let page;
      try {
        where = buildFleetWhere(tenantId, query as FleetSearchQuery);
        page = parsePagination(query as FleetSearchQuery);
      } catch (err) {
        if (!(err instanceof FleetFilterError)) throw err;
        // A rejected filter is the point — see the note in filters.ts about silent pass-through.
        set.status = 400;
        return { success: false, error: err.message };
      }

      const rows = db
        .select()
        .from(fleetMessages)
        .where(where)
        .orderBy(desc(fleetMessages.ts))
        .limit(page.limit)
        .offset(page.offset)
        .all();

      const counted = db
        .select({ total: sql<number>`count(*)` })
        .from(fleetMessages)
        .where(where)
        .get();

      return {
        success: true,
        data: {
          messages: rows,
          total: Number(counted?.total ?? 0),
          limit: page.limit,
          offset: page.offset,
        },
      };
    },
    {
      query: t.Object({
        query: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        since: t.Optional(t.String()),
        until: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      response: t.Object({
        success: t.Boolean(),
        error: t.Optional(t.String()),
        data: t.Optional(t.Object({
          messages: t.Array(fleetMessageSchema()),
          total: t.Number(),
          limit: t.Number(),
          offset: t.Number(),
        })),
      }),
    },
  );
}
