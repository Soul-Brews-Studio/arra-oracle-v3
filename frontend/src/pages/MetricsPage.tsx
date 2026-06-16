import { LoadingPanel } from '../components/AsyncState';
import { StatCard } from '../components/StatCard';
import type { MemoryUsageSnapshot, MetricsSnapshot } from '../../../src/server/types';

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

function percentBar(percent: number, label: string, value: number) {
  return (
    <li className="grid gap-2" key={label}>
      <div className="flex items-center justify-between text-sm text-slate-200">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium">{formatBytes(value)}</span>
      </div>
      <div className="h-2 rounded-full border border-white/10 bg-white/[0.06]">
        <div className="h-full rounded-full bg-teal-300/60 transition-all" style={{ width: `${Math.min(100, Math.max(3, percent)).toFixed(0)}%` }} />
      </div>
    </li>
  );
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

function buildMemoryBars(memory: MemoryUsageSnapshot): { label: string; bytes: number; ratio: number }[] {
  const points: Record<string, number> = {
    'Heap used': memory.heapUsed,
    'Heap total': memory.heapTotal,
    RSS: memory.rss,
    External: memory.external,
    'Array buffers': memory.arrayBuffers,
  };
  const max = Math.max(...Object.values(points));
  return Object.entries(points).map(([label, bytes]) => ({
    label,
    bytes,
    ratio: max > 0 ? (bytes / max) * 100 : 0,
  }));
}

function MetricsChartsCard({ metrics }: { metrics: MetricsSnapshot }) {
  const bars = buildMemoryBars(metrics.memoryUsage);
  const requestLoad = metrics.uptime > 0 ? Math.min((metrics.requestCount / metrics.uptime) * 60, 100) : 0;

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-labelledby="metrics-charts-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Charts</p>
      <h2 id="metrics-charts-title" className="mt-2 text-2xl font-semibold text-white">Memory distribution</h2>
      <p className="mt-2 text-sm text-slate-400">Live memory profile and request throughput from /api/v1/metrics.</p>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div>
          <p className="mb-3 text-sm text-slate-300">Memory usage (bytes)</p>
          <ul className="grid gap-3" aria-label="Memory distribution bars">
            {bars.map((bar) => percentBar(bar.ratio, bar.label, bar.bytes))}
          </ul>
        </div>
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <p className="text-sm text-slate-300">Request throughput</p>
          <p className="mt-2 text-4xl font-semibold text-white">{requestLoad.toFixed(1)} req/min</p>
          <p className="mt-2 text-sm text-slate-400">Derived from total request count and uptime.</p>
        </div>
      </div>
    </section>
  );
}

function MetricsActivityCard({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-labelledby="metrics-activity-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Recent activity</p>
      <h2 id="metrics-activity-title" className="mt-2 text-2xl font-semibold text-white">Runtime events</h2>
      <ul className="mt-4 grid gap-3 text-sm text-slate-300">
        <li className="rounded-2xl border border-white/10 p-3">
          <p className="text-slate-400">Last restart</p>
          <p className="mt-1 text-base font-semibold text-white">{restartLabel(metrics.lastRestart)}</p>
        </li>
        <li className="rounded-2xl border border-white/10 p-3">
          <p className="text-slate-400">Requests</p>
          <p className="mt-1 text-base font-semibold text-white">{metrics.requestCount.toLocaleString()} total processed</p>
          <p className="text-xs text-slate-400">{metrics.avgResponseMs} ms average response</p>
        </li>
        <li className="rounded-2xl border border-white/10 p-3">
          <p className="text-slate-400">Active connections</p>
          <p className="mt-1 text-base font-semibold text-white">{metrics.activeConnections}</p>
          <p className="text-xs text-slate-400">Currently tracked HTTP in-flight</p>
        </li>
      </ul>
    </section>
  );
}

export function MetricsPage(props: MetricsPageProps) {
  if (isRichMetrics(props)) {
    const { metrics, loading } = props;
    return (
      <div className="grid gap-5">
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="metrics-page-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Runtime metrics</p>
          <h2 id="metrics-page-title" className="mt-2 text-3xl font-semibold text-white">Metrics dashboard</h2>
          <p className="mt-2 text-sm text-slate-400">Runtime counters from GET /api/v1/metrics.</p>
        </section>

        {loading ? <div className="mt-1"><LoadingPanel title="Loading metrics" detail="Fetching /api/v1/metrics from the Elysia backend." /></div> : null}
        {!loading && !metrics ? <p className="mt-1 text-sm text-slate-400">No metrics snapshot is available yet.</p> : null}

        {metrics ? (
          <div className="grid gap-5 xl:grid-cols-3">
            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6 xl:col-span-2" aria-labelledby="metrics-stats-title">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Overview</p>
              <h2 id="metrics-stats-title" className="mt-2 text-2xl font-semibold text-white">Stats snapshot</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatCard label="Total docs" value="—" detail="Not exposed by /api/v1/metrics endpoint" />
                <StatCard label="Indexing rate" value={`${Math.min((metrics.requestCount / Math.max(1, metrics.uptime)) * 60, 9999).toFixed(1)} req/min`} detail="Proxy rate from total requests and uptime" />
                <StatCard label="Uptime" value={formatDuration(metrics.uptime)} detail={`last restart ${restartLabel(metrics.lastRestart)}`} />
              </div>
            </section>
            <MetricsActivityCard metrics={metrics} />
          </div>
        ) : null}

        {metrics ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <MetricsChartsCard metrics={metrics} />
            <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="memory-stats-title">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Memory</p>
              <h2 id="memory-stats-title" className="mt-2 text-2xl font-semibold text-white">Memory usage</h2>
              <dl className="mt-4 grid gap-3 text-sm text-slate-300">
                <div><dt className="text-slate-500">Heap used</dt><dd className="font-medium text-white">{formatBytes(metrics.memoryUsage.heapUsed)}</dd></div>
                <div><dt className="text-slate-500">RSS</dt><dd className="font-medium text-white">{formatBytes(metrics.memoryUsage.rss)}</dd></div>
                <div><dt className="text-slate-500">External + buffers</dt><dd className="font-medium text-white">{formatBytes(metrics.memoryUsage.external + metrics.memoryUsage.arrayBuffers)}</dd></div>
              </dl>
            </section>
          </div>
        ) : null}
      </div>
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
