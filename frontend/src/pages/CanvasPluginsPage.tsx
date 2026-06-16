import { useEffect, useMemo, useState } from 'react';
import { fetchCanvasPlugins, type CanvasPluginEntry, type CanvasPluginKind, type CanvasPluginsResponse } from '../api/canvas-plugins';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';

type PageState = 'loading' | 'ready' | 'error';
type CanvasKindFilter = CanvasPluginKind | 'all';
type CanvasClient = { canvasPlugins: (kind?: CanvasPluginKind) => Promise<CanvasPluginsResponse> };
const defaultClient: CanvasClient = { canvasPlugins: (kind) => fetchCanvasPlugins(kind) };

const filterOptions: Array<{ kind: CanvasKindFilter; label: string; description: string }> = [
  { kind: 'all', label: 'All canvas plugins', description: 'Show every standalone canvas target.' },
  { kind: 'three', label: 'Three scenes', description: 'Show shader and 3D scene mounts.' },
  { kind: 'react', label: 'React apps', description: 'Show data-backed React canvases.' },
];

export interface CanvasPluginsPageProps {
  plugins?: CanvasPluginEntry[];
  loading?: boolean;
  client?: CanvasClient;
  standaloneHost?: string;
}

function withCanvasHost(path: string, host?: string): string {
  if (!host) return path;
  const origin = host.startsWith('http') ? host : `https://${host}`;
  return new URL(path.startsWith('/') ? path : `/${path}`, origin).toString();
}

function pluginHref(plugin: CanvasPluginEntry, host?: string): string {
  if (plugin.standalonePath) return withCanvasHost(plugin.standalonePath, host);
  const qs = new URLSearchParams(plugin.query ?? { plugin: plugin.id });
  return withCanvasHost(`${plugin.path || '/canvas'}?${qs.toString()}`, host);
}

function statusClass(plugin: CanvasPluginEntry): string {
  if (plugin.kind === 'react') return 'border-purple-300/30 bg-purple-300/10 text-purple-100';
  return 'border-teal-300/30 bg-teal-300/10 text-teal-100';
}

function PluginCard({ plugin, host }: { plugin: CanvasPluginEntry; host?: string }) {
  const target = pluginHref(plugin, host);
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

export function CanvasPluginsPage({ plugins: initialPlugins = [], loading = true, client = defaultClient, standaloneHost = '' }: CanvasPluginsPageProps) {
  const [plugins, setPlugins] = useState(initialPlugins);
  const [host, setHost] = useState(standaloneHost);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState<CanvasKindFilter>('all');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    client.canvasPlugins(kindFilter === 'all' ? undefined : kindFilter)
      .then((response) => {
        if (cancelled) return;
        setPlugins(response.plugins);
        setHost(response.standalone?.host ?? standaloneHost);
        setState('ready');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState(initialPlugins.length ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client, initialPlugins.length, kindFilter, standaloneHost]);

  const endpointHint = kindFilter === 'all' ? '/api/plugins?kind=canvas' : `/api/canvas/plugins?kind=${kindFilter}`;

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
        <p className="mt-2 text-sm text-slate-400">Filter the standalone registry by runtime while keeping canvas.buildwithoracle.com targets visible.</p>
        <p className="mt-2 font-mono text-xs text-slate-500">Registry endpoint: {endpointHint}</p>
        <p className="mt-3 inline-flex rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Canvas plugin runtime filters">
          {filterOptions.map((option) => (
            <button
              key={option.kind}
              aria-pressed={kindFilter === option.kind}
              className={`focus-ring rounded-xl border px-3 py-2 text-left text-sm ${kindFilter === option.kind ? 'border-teal-300/40 bg-teal-300/10 text-teal-100' : 'border-white/10 text-slate-300 hover:border-teal-300/30'}`}
              type="button"
              onClick={() => setKindFilter(option.kind)}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className="block text-xs opacity-70">{option.description}</span>
            </button>
          ))}
        </div>
      </header>

      {state === 'loading' ? <LoadingPanel title="Loading canvas plugins" detail={`Reading ${endpointHint}.`} /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load canvas plugins." message={error} /> : null}
      {state !== 'error' && error ? <ErrorMessage title="Canvas plugin warning" message={error} /> : null}
      {state !== 'error' ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} host={host} />)}</div> : null}
    </section>
  );
}
