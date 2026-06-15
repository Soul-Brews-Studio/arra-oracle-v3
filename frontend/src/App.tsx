import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMenu, fetchPlugins } from './api';
import { ErrorMessage, LoadingPanel, Spinner } from './components/AsyncState';
import { McpToolBrowser } from './components/McpToolBrowser';
import { VectorSearchWidget } from './components/VectorSearchWidget';
import type { LoadState, MenuItem, PluginEntry } from './types';

type Surface = 'wasm' | 'menu' | 'server';

function surfacesFor(plugin: PluginEntry): Surface[] {
  const surfaces: Surface[] = [];
  if (plugin.file) surfaces.push('wasm');
  if (plugin.menu) surfaces.push('menu');
  if (plugin.server) surfaces.push('server');
  return surfaces;
}

function groupMenu(items: MenuItem[]) {
  return items.reduce<Record<string, MenuItem[]>>((groups, item) => {
    const key = item.group ?? 'tools';
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function StatCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/10">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-medium text-teal-200">
      {children}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">{text}</div>;
}

function MenuViewer({ items }: { items: MenuItem[] }) {
  const groups = groupMenu(items);
  const orderedGroups = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  if (!items.length) return <EmptyState text="No menu items returned from /api/menu." />;

  return (
    <div className="space-y-5">
      {orderedGroups.map((group) => (
        <section key={group} aria-labelledby={`menu-${group}`}>
          <h3 id={`menu-${group}`} className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            {group}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...groups[group]]
              .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
              .map((item) => (
                <a
                  key={`${item.path}-${item.label}`}
                  href={item.path}
                  className="focus-ring rounded-xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-teal-300/40 hover:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{item.label}</p>
                      <p className="mt-1 font-mono text-xs text-teal-200">{item.path}</p>
                    </div>
                    <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-400">#{item.order ?? 999}</span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {item.sourceName ? `${item.source ?? 'source'}:${item.sourceName}` : item.source ?? 'route'}
                  </p>
                </a>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PluginList({ plugins }: { plugins: PluginEntry[] }) {
  if (!plugins.length) return <EmptyState text="No plugins registered in /api/plugins." />;

  return (
    <div className="grid gap-4">
      {plugins.map((plugin) => {
        const surfaces = surfacesFor(plugin);
        return (
          <article key={plugin.name} className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{plugin.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{plugin.description ?? 'No description supplied.'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {surfaces.length ? surfaces.map((surface) => <Badge key={surface}>{surface}</Badge>) : <Badge>metadata</Badge>}
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Version</dt>
                <dd className="font-mono text-slate-200">{plugin.version ?? 'unknown'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Artifact</dt>
                <dd className="font-mono text-slate-200">{plugin.file || 'server-only'}</dd>
              </div>
              {plugin.server ? (
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Server</dt>
                  <dd className="font-mono text-slate-200">
                    {plugin.server.command} {(plugin.server.args ?? []).join(' ')} · {plugin.server.healthPath ?? '/health'}
                  </dd>
                </div>
              ) : null}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<LoadState>('idle');
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('never');

  async function load() {
    setState('loading');
    setError('');
    try {
      const [menuResponse, pluginsResponse] = await Promise.all([fetchMenu(), fetchPlugins()]);
      setMenu(menuResponse.items);
      setPlugins(pluginsResponse.plugins);
      setUpdatedAt(new Date().toLocaleTimeString());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const surfaceCount = useMemo(() => plugins.reduce((total, plugin) => total + Math.max(1, surfacesFor(plugin).length), 0), [plugins]);
  const loading = state === 'loading' || state === 'idle';
  const retryButton = (
    <button
      className="focus-ring rounded-lg border border-red-200/30 px-3 py-2 text-sm font-semibold text-red-50 hover:bg-red-200/10"
      type="button"
      onClick={() => void load()}
    >
      Retry
    </button>
  );

  return (
    <main className="oracle-shell min-h-screen text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-black/30 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-teal-300">Arra Oracle</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">Frontend Control Surface</h1>
            <p className="mt-3 max-w-2xl text-slate-400">
              Live menu and plugin inventory from the Elysia backend via the Vite `/api/*` proxy.
            </p>
          </div>
          <button
            className="focus-ring rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200"
            disabled={loading}
            type="button"
            onClick={() => void load()}
          >
            {loading ? <Spinner label="Refreshing" /> : 'Refresh data'}
          </button>
        </header>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Summary">
          <StatCard label="Menu items" value={loading ? <Spinner label="Loading" /> : menu.length} detail="from /api/menu" />
          <StatCard label="Plugins" value={loading ? <Spinner label="Loading" /> : plugins.length} detail="from /api/plugins" />
          <StatCard label="Surfaces" value={loading ? <Spinner label="Loading" /> : surfaceCount} detail={`updated ${updatedAt}`} />
        </section>

        {state === 'error' ? (
          <ErrorMessage title="Could not load backend data." message={error} action={retryButton} />
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <VectorSearchWidget />
          <McpToolBrowser />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section id="menu" className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
            <h2 className="mb-4 text-2xl font-semibold text-white">Menu viewer</h2>
            {loading ? <LoadingPanel title="Loading menu items…" detail="Fetching /api/menu from the Elysia backend." /> : <MenuViewer items={menu} />}
          </section>

          <section id="plugins" className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
            <h2 className="mb-4 text-2xl font-semibold text-white">Plugin list</h2>
            {loading ? <LoadingPanel title="Loading plugins…" detail="Fetching /api/plugins and plugin server manifests." /> : <PluginList plugins={plugins} />}
          </section>
        </div>
      </div>
    </main>
  );
}
