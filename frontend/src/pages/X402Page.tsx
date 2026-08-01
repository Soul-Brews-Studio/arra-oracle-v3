import { Badge, type BadgeTone } from '../components/Badge';
import { LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import { MeterBar } from '../components/MeterBar';
import { StatCard } from '../components/StatCard';
import type { X402Status, X402StatsRecentEntry, X402StatsResponse } from '../../../src/routes/x402/stats-types';

const statusTone: Record<X402Status, BadgeTone> = {
  settled: 'success',
  unpaid: 'neutral',
  rejected: 'warning',
  handler_failed: 'danger',
  settlement_failed: 'danger',
};

const statusLabel: Record<X402Status, string> = {
  settled: 'Settled',
  unpaid: 'Unpaid',
  rejected: 'Rejected',
  handler_failed: 'Handler failed',
  settlement_failed: 'Settlement failed',
};

function formatAmount(amount: string | null): string {
  if (!amount) return '—';
  const approx = Number(amount) / 1e6;
  return `${amount} (≈$${approx.toFixed(4)})`;
}

function shortHash(value: string | null): string {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function X402StatCards({ totals }: { totals: X402StatsResponse['totals'] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="x402 request totals">
      <StatCard label="Total Requests" value={totals.requests} detail="All POST /api/x402/ask attempts logged" tone="accent" />
      <StatCard label="Settled" value={totals.settled} detail="Payments verified and settled on-chain" tone="success" />
      <StatCard
        label="Rejected / Unpaid"
        value={totals.rejected + totals.unpaid}
        detail={`${totals.rejected} rejected · ${totals.unpaid} unpaid`}
        tone="warning"
      />
      <StatCard label="Failed" value={totals.failed} detail="Handler or settlement failures after payment" tone="danger" />
      <StatCard
        label="Revenue (approx)"
        value={`$${totals.revenueApprox.toFixed(4)}`}
        detail={`${totals.revenueAtomic} atomic units settled (6-decimal stablecoin)`}
        tone="accent"
      />
    </section>
  );
}

function X402MetersCard({ totals }: { totals: X402StatsResponse['totals'] }) {
  return (
    <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="x402-meters-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Rates</p>
      <h2 id="x402-meters-title" className="mt-2 text-2xl font-semibold text-text">Settlement outcomes</h2>
      <div className="mt-4 grid gap-4">
        <MeterBar
          label="Settlement rate"
          valueText={`${totals.settled}/${totals.requests} settled`}
          percent={totals.requests > 0 ? (totals.settled / totals.requests) * 100 : 0}
          tone="success"
          description="Share of all logged requests that reached a settled payment."
        />
        <MeterBar
          label="Rejected or unpaid"
          valueText={`${totals.rejected + totals.unpaid}/${totals.requests}`}
          percent={totals.requests > 0 ? ((totals.rejected + totals.unpaid) / totals.requests) * 100 : 0}
          tone="warning"
          description="Requests that never completed payment (no on-chain cost)."
        />
      </div>
    </section>
  );
}

function X402RecentTable({ recent }: { recent: X402StatsRecentEntry[] }) {
  if (recent.length === 0) return <EmptyState text="No x402 requests logged yet." />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <thead className="glass text-xs uppercase tracking-[0.18em] text-text-muted">
          <tr>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Route</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Network</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Payer</th>
            <th className="px-4 py-3">Transaction</th>
            <th className="px-4 py-3">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-text">
          {recent.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 text-text-muted">{new Date(row.createdAt).toLocaleString()}</td>
              <td className="px-4 py-3 font-mono text-xs text-text-muted">{row.route}</td>
              <td className="px-4 py-3"><Badge tone={statusTone[row.status]}>{statusLabel[row.status]}</Badge></td>
              <td className="px-4 py-3 text-text-muted">{row.network ?? '—'}</td>
              <td className="px-4 py-3 text-text-muted">{formatAmount(row.amount)}</td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs" title={row.payer ?? undefined}>{shortHash(row.payer)}</span>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs" title={row.transaction ?? undefined}>{shortHash(row.transaction)}</span>
              </td>
              <td className={`px-4 py-3 ${row.errorReason ? 'text-err-text' : 'text-text-muted'}`}>{row.errorReason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function X402Page({ stats, loading }: { stats: X402StatsResponse | null; loading: boolean }) {
  return (
    <div className="grid w-full min-w-0 gap-5">
      <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="x402-page-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">x402 payments</p>
        <h2 id="x402-page-title" className="mt-2 text-3xl font-semibold text-text">x402 activity</h2>
        <p className="mt-2 text-sm text-text-muted">Paid request totals and recent log entries from GET /api/x402/stats.</p>
      </section>

      {loading ? <LoadingPanel title="Loading x402 stats" detail="Fetching /api/x402/stats from the Elysia backend." /> : null}
      {!loading && !stats ? <p className="mt-1 text-sm text-text-muted">No x402 stats are available yet.</p> : null}

      {stats ? (
        <>
          <X402StatCards totals={stats.totals} />
          <X402MetersCard totals={stats.totals} />
          <section className="glass rounded-3xl p-5 sm:p-6" aria-labelledby="x402-recent-title">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Recent</p>
            <h2 id="x402-recent-title" className="mt-2 text-2xl font-semibold text-text">Recent requests</h2>
            <div className="mt-4">
              <X402RecentTable recent={stats.recent} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
