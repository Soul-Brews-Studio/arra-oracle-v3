import { useEffect, useMemo, useState } from 'react';
import { fetchCanvasPlugins, type CanvasPluginEntry, type CanvasPluginsResponse } from '../api/canvas-plugins';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';

type PageState = 'loading' | 'ready' | 'error';
type CanvasClient = { canvasPlugins: () => Promise<CanvasPluginsResponse> };
const defaultClient: CanvasClient = { canvasPlugins: () => fetchCanvasPlugins() };

export interface CanvasPluginsPageProps {
  plugins?: CanvasPluginEntry[];
  loading?: boolean;
  client?: CanvasClient;
}

function pluginHref(plugin: CanvasPluginEntry): string {
  const qs = new URLSearchParams(plugin.query ?? { plugin: plugin.id });
  return `${plugin.path || '/canvas'}?${qs.toString()}`;
}

function statusClass(plugin: CanvasPluginEntry): string {
  if (plugin.kind === 'react') return 'border-purple-300/30 bg-purple-300/10 text-purple-100';
  return 'border-teal-300/30 bg-teal-300/10 text-teal-100';
}

function PluginCard({ plugin }: { plugin: CanvasPluginEntry }) {
  const target = pluginHref(plugin);
  return (
    <article className="rounded-3xl border border-white/10 bg-slate-950/70 p-5" aria-label={`${plugin.label} canvas plugin`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{plugin.id}</p>
          <h3 className="mt-1 text-xl font-semibold text-white">{plugin.label}</h3>
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(plugin)}`}>{plugin.kind}</span>
      </div>
      <p className="text-sm text-slate-300">{plugin.description}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        <div><dt className="text-slate-500">Status</dt><dd className="font-semibold text-emerald-200">registered</dd></div>
        <div><dt className="text-slate-500">Canvas target</dt><dd className="break-all font-mono text-slate-100">{target}</dd></div>
        <div><dt className="text-slate-500">Runtime hook</dt><dd className="font-mono text-slate-100">{'renderer' in plugin ? plugin.renderer : plugin.mount}</dd></div>
        {'apiPath' in plugin && plugin.apiPath ? <div><dt className="text-slate-500">Data API</dt><dd className="font-mono text-slate-100">{plugin.apiPath}</dd></div> : null}
      </dl>
      <a className="focus-ring mt-4 inline-flex rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10" href={target}>Open canvas</a>
    </article>
  );
}

export function CanvasPluginsPage({ plugins: initialPlugins = [], loading = true, client = defaultClient }: CanvasPluginsPageProps) {
  const [plugins, setPlugins] = useState(initialPlugins);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    client.canvasPlugins()
      .then((response) => {
        if (cancelled) return;
        setPlugins(response.plugins);
        setState('ready');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState(initialPlugins.length ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client, initialPlugins.length]);

  const summary = useMemo(() => {
    const react = plugins.filter((plugin) => plugin.kind === 'react').length;
    const three = plugins.filter((plugin) => plugin.kind === 'three').length;
    return `${plugins.length} registered · ${three} three · ${react} react`;
  }, [plugins]);

  return (
    <section className="grid gap-5" aria-labelledby="canvas-plugins-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Canvas plugins</p>
        <h1 id="canvas-plugins-title" className="mt-2 text-3xl font-semibold text-white">Canvas plugin registry</h1>
        <p className="mt-2 text-sm text-slate-400">Fetched from /api/canvas/plugins for canvas.buildwithoracle.com standalone rendering.</p>
        <p className="mt-3 inline-flex rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
      </header>

      {state === 'loading' ? <LoadingPanel title="Loading canvas plugins" detail="Reading /api/canvas/plugins." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load canvas plugins." message={error} /> : null}
      {state !== 'error' && error ? <ErrorMessage title="Canvas plugin warning" message={error} /> : null}
      {state !== 'error' ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} />)}</div> : null}
    </section>
  );
}
