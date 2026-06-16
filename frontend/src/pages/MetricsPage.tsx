import { StatCard } from '../components/StatCard';

type MetricsPageProps = {
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
};

export function MetricsPage({ menuCount, pluginCount, surfaceCount, updatedAt }: MetricsPageProps) {
  return (
    <section className="grid gap-4" aria-labelledby="metrics-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Metrics</p>
      <h2 id="metrics-page-title" className="text-2xl font-semibold text-white">Runtime metrics</h2>
      <p className="text-sm text-slate-400">Track dashboard and surface counts while debugging</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Menu entries" value={menuCount} detail="Items loaded from /api/menu." />
        <StatCard label="Plugins" value={pluginCount} detail="Active plugin registry count." />
        <StatCard label="Surfaces" value={surfaceCount} detail="Distinct plugin surfaces." />
        <StatCard label="Last refresh" value={updatedAt} detail="Last successful backend refresh." />
      </div>
    </section>
  );
}
