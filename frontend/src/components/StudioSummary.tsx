import type { MetricsSnapshot } from '../../../src/server/types';
import { Spinner } from './AsyncState';
import { StatCard } from './StatCard';

/**
 * Backend-wide counters for the dashboard.
 *
 * This used to live in `AppShell`, rendered above `{children}` with no
 * condition, so all 34 routes carried it. On `/metrics` that meant 13 stat
 * cards — five of them about the menu and plugin inventory, which that page is
 * not about. On `/tools/config` it meant five cards with no relationship to the
 * page at all.
 *
 * DESIGN.md already states the intended hierarchy: sidebar → breadcrumb →
 * route title → summary → "one focused routed page at a time". These counters
 * are dashboard *content*, not shell chrome, so they belong to the route that
 * is about backend inventory.
 */
export type StudioSummaryProps = {
  loading: boolean;
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  metrics?: MetricsSnapshot | null;
  metricsLoading?: boolean;
  updatedAt: string;
};

export function StudioSummary({
  loading,
  menuCount,
  pluginCount,
  surfaceCount,
  metrics = null,
  metricsLoading = false,
  updatedAt,
}: StudioSummaryProps) {
  // Copied verbatim from AppShell so the rendered output is byte-identical —
  // this move is a relocation, not a redesign.
  const requestValue = metricsLoading ? <Spinner label="Loading metrics" /> : metrics?.requestCount ?? '—';
  const responseValue = metricsLoading ? <Spinner label="Loading metrics" /> : `${metrics?.avgResponseMs ?? 0} ms`;
  const metricsDetail = metrics
    ? `${metrics.activeConnections} active · uptime ${Math.round(metrics.uptime)}s`
    : 'from /api/v1/metrics';

  return (
    <section
      className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-5 xl:gap-6 [&>article]:border-[oklch(1_0_0/0.08)] [&>article]:bg-[oklch(0.16_0.02_265/0.35)] [&>article]:shadow-[0_8px_32px_oklch(0_0_0/0.28)] [&>article]:backdrop-blur-xl"
      aria-label="Backend summary"
    >
      <StatCard label="Menu items" value={loading ? <Spinner label="Loading" /> : menuCount} detail="from /api/menu" tone="accent" />
      <StatCard label="Plugins" value={loading ? <Spinner label="Loading" /> : pluginCount} detail="from /api/plugins" tone="success" />
      <StatCard label="Surfaces" value={loading ? <Spinner label="Loading" /> : surfaceCount} detail={`updated ${updatedAt}`} tone="accent" />
      <StatCard label="Requests" value={requestValue} detail={metricsDetail} tone="neutral" />
      <StatCard label="Avg response" value={responseValue} detail="real-time backend latency" tone="neutral" />
    </section>
  );
}
