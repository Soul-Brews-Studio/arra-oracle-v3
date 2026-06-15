import { LoadingPanel } from '../components/AsyncState';
import { PluginList } from '../components/PluginList';
import type { PluginEntry } from '../types';

export function PluginsPage({ plugins, loading }: { plugins: PluginEntry[]; loading: boolean }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="plugins-page-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Plugins</p>
      <h2 id="plugins-page-title" className="mt-2 mb-4 text-2xl font-semibold text-white">Plugin list</h2>
      {loading ? <LoadingPanel title="Loading plugins…" detail="Fetching /api/plugins and plugin server manifests." /> : <PluginList plugins={plugins} />}
    </section>
  );
}
