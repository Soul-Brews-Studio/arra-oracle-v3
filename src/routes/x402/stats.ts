import { Elysia, t } from 'elysia';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, x402RequestLog } from '../../db/index.ts';
import { activeTenantId } from '../../middleware/tenant.ts';
import type { X402Status, X402StatsRecentEntry, X402StatsResponse } from './stats-types.ts';

// Re-exported for backward compatibility / discoverability (types are defined in
// stats-types.ts, a dependency-free module, so the frontend can import them without
// pulling `db`/bun:sqlite into its own tsc pass).
export type { X402Status, X402StatsRecentEntry, X402StatsResponse } from './stats-types.ts';

function scoped(condition?: SQL): SQL {
  const tenantFilter = eq(x402RequestLog.tenantId, activeTenantId());
  return condition ? and(condition, tenantFilter)! : tenantFilter;
}

const STABLECOIN_DECIMALS = 6; // USDC and every asset x402 defaults to today

/** GET /api/x402/stats — request totals, approximate revenue, and recent log entries. */
export const x402StatsRoutes = new Elysia({ prefix: '/api' }).get(
  '/x402/stats',
  ({ query }): X402StatsResponse => {
    const limit = Math.max(1, Math.min(200, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);

    const byStatus = db
      .select({ status: x402RequestLog.status, count: sql<number>`count(*)` })
      .from(x402RequestLog)
      .where(scoped())
      .groupBy(x402RequestLog.status)
      .all();

    const counts: Record<string, number> = {};
    for (const row of byStatus) counts[row.status] = row.count;

    const revenueRow = db
      .select({ total: sql<string>`coalesce(sum(cast(${x402RequestLog.amount} as integer)), 0)` })
      .from(x402RequestLog)
      .where(scoped(eq(x402RequestLog.status, 'settled')))
      .get();
    const revenueAtomic = revenueRow?.total ?? '0';

    const recentRows = db
      .select({
        id: x402RequestLog.id,
        route: x402RequestLog.route,
        status: x402RequestLog.status,
        network: x402RequestLog.network,
        asset: x402RequestLog.asset,
        amount: x402RequestLog.amount,
        payer: x402RequestLog.payer,
        transaction: x402RequestLog.transaction,
        errorReason: x402RequestLog.errorReason,
        createdAt: x402RequestLog.createdAt,
      })
      .from(x402RequestLog)
      .where(scoped())
      .orderBy(desc(x402RequestLog.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    // The status column is a plain text() in the Drizzle schema (src/db/x402-schema.ts),
    // so drizzle infers `string`; narrow it to the known enum for the exported response type.
    const recent: X402StatsRecentEntry[] = recentRows.map((row) => ({ ...row, status: row.status as X402Status }));

    const requests = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return {
      totals: {
        requests,
        settled: counts.settled ?? 0,
        rejected: counts.rejected ?? 0,
        unpaid: counts.unpaid ?? 0,
        failed: (counts.handler_failed ?? 0) + (counts.settlement_failed ?? 0),
        revenueAtomic,
        revenueApprox: Number(revenueAtomic) / 10 ** STABLECOIN_DECIMALS,
      },
      recent,
    };
  },
  {
    query: t.Object({ limit: t.Optional(t.String()), offset: t.Optional(t.String()) }),
    detail: {
      tags: ['x402'],
      menu: { group: 'tools', path: '/x402', order: 65, label: 'x402' },
      summary: 'x402 paid-route request totals, revenue, and recent log entries',
    },
  },
);
