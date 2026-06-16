import { LoadingPanel } from '../components/AsyncState';
import { StatCard } from '../components/StatCard';
import type { MetricsSnapshot } from '../../../src/server/types';

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  if (minutes < 60) return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
}

function restartLabel(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return new Date(timestamp).toLocaleString();
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

type RichMetricsProps = {
  metrics: MetricsSnapshot | null;
  loading: boolean;
};

type SimpleMetricsProps = {
  metrics?: never;
  loading?: never;
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
};

type MetricsPageProps = RichMetricsProps | SimpleMetricsProps;

function isRichMetrics(props: MetricsPageProps): props is RichMetricsProps {
  return typeof (props as RichMetricsProps).loading === 'boolean' || (props as RichMetricsProps).metrics !== undefined;
}

export function MetricsPage(props: MetricsPageProps) {
  if (isRichMetrics(props)) {
    const { metrics, loading } = props;
    return (
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="metrics-page-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Runtime metrics</p>
        <h2 id="metrics-page-title" className="mt-2 text-2xl font-semibold text-white">Metrics dashboard</h2>
        <p className="mt-2 text-sm text-slate-400">Runtime counters from GET /api/v1/metrics.</p>

        {loading ? <div className="mt-5"><LoadingPanel title="Loading metrics" detail="Fetching /api/v1/metrics from the Elysia backend." /></div> : null}
        {!loading && !metrics ? <p className="mt-5 text-sm text-slate-400">No metrics snapshot is available yet.</p> : null}

        {metrics ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Uptime" value={formatDuration(metrics.uptime)} detail={`last restart ${restartLabel(metrics.lastRestart)}`} />
            <StatCard label="Requests" value={metrics.requestCount} detail={`${metrics.avgResponseMs} ms average response`} />
            <StatCard
              label="Memory usage"
              value={metrics.memoryUsage ? formatBytes(metrics.memoryUsage.heapUsed) : '—'}
              detail={metrics.memoryUsage ? `${formatBytes(metrics.memoryUsage.rss)} RSS` : 'memory data unavailable'}
            />
            <StatCard label="Active connections" value={metrics.activeConnections} detail="currently tracked HTTP requests" />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="metrics-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Runtime metrics</p>
      <h2 id="metrics-page-title" className="text-2xl font-semibold text-white">Runtime metrics</h2>
      <p className="text-sm text-slate-400">Track dashboard and surface counts while debugging</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mt-5">
        <StatCard label="Menu entries" value={props.menuCount} detail="Items loaded from /api/menu." />
        <StatCard label="Plugins" value={props.pluginCount} detail="Active plugin registry count." />
        <StatCard label="Surfaces" value={props.surfaceCount} detail="Distinct plugin surfaces." />
        <StatCard label="Last refresh" value={props.updatedAt} detail="Last successful backend refresh." />
      </div>
    </section>
  );
}
