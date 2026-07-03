import { LoadingPanel } from '../components/AsyncState';
import { MeterBar, type MeterTone } from '../components/MeterBar';
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
  const tones: MeterTone[] = ['accent', 'accent2', 'success', 'warning', 'danger'];

  return (
    <section className="rounded-3xl border border-border bg-surface-muted p-5 sm:p-6" aria-labelledby="metrics-charts-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Charts</p>
      <h2 id="metrics-charts-title" className="mt-2 text-2xl font-semibold text-text">Memory distribution</h2>
      <p className="mt-2 text-sm text-text-muted">Live memory profile and request throughput from /api/v1/metrics.</p>

      <div className="mt-5 grid min-w-0 gap-6 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        <div>
          <p className="mb-3 text-sm text-text-muted">Memory usage (bytes)</p>
          <ul className="grid gap-3" aria-label="Memory distribution bars">
            {bars.map((bar, index) => (
              <li key={bar.label}>
                <MeterBar
                  label={bar.label}
                  percent={bar.ratio}
                  tone={tones[index % tones.length]}
                  valueText={formatBytes(bar.bytes)}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-surface-muted p-4">
          <p className="text-sm text-text-muted">Request throughput</p>
          <p className="mt-2 text-4xl font-semibold text-text">{requestLoad.toFixed(1)} req/min</p>
          <div className="mt-4">
            <MeterBar
              description="Derived from total request count and uptime."
              label="Per-minute load"
              percent={requestLoad}
              tone="accent2"
              valueText={`${requestLoad.toFixed(1)} req/min`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricsActivityCard({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <section className="min-w-0 rounded-3xl border border-border bg-surface-muted p-5 sm:p-6" aria-labelledby="metrics-activity-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Recent activity</p>
      <h2 id="metrics-activity-title" className="mt-2 text-2xl font-semibold text-text">Runtime events</h2>
      <ul className="mt-4 grid gap-3 text-sm text-text-muted">
        <li className="rounded-2xl border border-border p-3">
          <p className="text-text-muted">Last restart</p>
          <p className="mt-1 text-base font-semibold text-text">{restartLabel(metrics.lastRestart)}</p>
        </li>
        <li className="rounded-2xl border border-border p-3">
          <p className="text-text-muted">Requests</p>
          <p className="mt-1 text-base font-semibold text-text">{metrics.requestCount.toLocaleString()} total processed</p>
          <p className="text-xs text-text-muted">{metrics.avgResponseMs} ms average response</p>
        </li>
        <li className="rounded-2xl border border-border p-3">
          <p className="text-text-muted">Active connections</p>
          <p className="mt-1 text-base font-semibold text-text">{metrics.activeConnections}</p>
          <p className="text-xs text-text-muted">Currently tracked HTTP in-flight</p>
        </li>
      </ul>
    </section>
  );
}

export function MetricsPage(props: MetricsPageProps) {
  if (isRichMetrics(props)) {
    const { metrics, loading } = props;
    return (
      <div className="grid w-full min-w-0 gap-5">
        <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="metrics-page-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Runtime metrics</p>
          <h2 id="metrics-page-title" className="mt-2 text-3xl font-semibold text-text">Metrics dashboard</h2>
          <p className="mt-2 text-sm text-text-muted">Runtime counters from GET /api/v1/metrics.</p>
        </section>

        {loading ? <div className="mt-1"><LoadingPanel title="Loading metrics" detail="Fetching /api/v1/metrics from the Elysia backend." /></div> : null}
        {!loading && !metrics ? <p className="mt-1 text-sm text-text-muted">No metrics snapshot is available yet.</p> : null}

        {metrics ? (
          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="metrics-stats-title">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Overview</p>
              <h2 id="metrics-stats-title" className="mt-2 text-2xl font-semibold text-text">Stats snapshot</h2>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
                <StatCard label="Total docs" value="—" detail="Not exposed by /api/v1/metrics endpoint" tone="accent" />
                <StatCard label="Indexing rate" value={`${Math.min((metrics.requestCount / Math.max(1, metrics.uptime)) * 60, 9999).toFixed(1)} req/min`} detail="Proxy rate from total requests and uptime" tone="success" />
                <StatCard label="Uptime" value={formatDuration(metrics.uptime)} detail={`last restart ${restartLabel(metrics.lastRestart)}`} tone="accent" />
              </div>
            </section>
            <MetricsActivityCard metrics={metrics} />
          </div>
        ) : null}

        {metrics ? (
          <div className="grid min-w-0 gap-5 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            <MetricsChartsCard metrics={metrics} />
            <section className="min-w-0 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="memory-stats-title">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Memory</p>
              <h2 id="memory-stats-title" className="mt-2 text-2xl font-semibold text-text">Memory usage</h2>
              <dl className="mt-4 grid gap-3 text-sm text-text-muted">
                <div><dt className="text-text-muted">Heap used</dt><dd className="font-medium text-text">{formatBytes(metrics.memoryUsage.heapUsed)}</dd></div>
                <div><dt className="text-text-muted">RSS</dt><dd className="font-medium text-text">{formatBytes(metrics.memoryUsage.rss)}</dd></div>
                <div><dt className="text-text-muted">External + buffers</dt><dd className="font-medium text-text">{formatBytes(metrics.memoryUsage.external + metrics.memoryUsage.arrayBuffers)}</dd></div>
              </dl>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="metrics-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Runtime metrics</p>
      <h2 id="metrics-page-title" className="text-2xl font-semibold text-text">Runtime metrics</h2>
      <p className="text-sm text-text-muted">Track dashboard and surface counts while debugging</p>
      <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        <StatCard label="Menu entries" value={props.menuCount} detail="Items loaded from /api/menu." />
        <StatCard label="Plugins" value={props.pluginCount} detail="Active plugin registry count." />
        <StatCard label="Surfaces" value={props.surfaceCount} detail="Distinct plugin surfaces." />
        <StatCard label="Last refresh" value={props.updatedAt} detail="Last successful backend refresh." />
      </div>
    </section>
  );
}
