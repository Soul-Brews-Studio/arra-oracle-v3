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

function restartLabel(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return new Date(timestamp).toLocaleString();
}

export function MetricsPage({ metrics, loading }: { metrics: MetricsSnapshot | null; loading: boolean }) {
  const memory = metrics?.memoryUsage;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="metrics-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Runtime metrics</p>
      <h1 id="metrics-page-title" className="mt-2 text-3xl font-semibold text-white">Metrics dashboard</h1>
      <p className="mt-2 text-sm text-slate-400">Live counters from GET /api/v1/metrics.</p>

      {loading ? <div className="mt-5"><LoadingPanel title="Loading metrics…" detail="Fetching /api/v1/metrics from the Elysia backend." /></div> : null}
      {!loading && !metrics ? <p className="mt-5 text-sm text-slate-400">No metrics snapshot is available yet.</p> : null}

      {metrics ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Uptime" value={formatDuration(metrics.uptime)} detail={`last restart ${restartLabel(metrics.lastRestart)}`} />
          <StatCard label="Requests" value={metrics.requestCount} detail={`${metrics.avgResponseMs} ms average response`} />
          <StatCard label="Memory usage" value={memory ? formatBytes(memory.heapUsed) : '—'} detail={memory ? `${formatBytes(memory.rss)} RSS` : 'memory data unavailable'} />
          <StatCard label="Active connections" value={metrics.activeConnections} detail="currently tracked HTTP requests" />
        </div>
      ) : null}
    </section>
  );
}
