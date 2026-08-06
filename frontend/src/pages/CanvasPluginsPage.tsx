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
  if (plugin.kind === 'react') return 'border-accent2-border text-accent2';
  return 'border-accent-border text-accent';
}

function PluginCard({ plugin, host }: { plugin: CanvasPluginEntry; host?: string }) {
  const target = pluginHref(plugin, host);
  return (
    <article className="glass min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5" aria-label={`${plugin.label} canvas plugin`}>
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">{plugin.id}</p>
          <h3 className="mt-1 break-words text-xl font-semibold text-text">{plugin.label}</h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(plugin)}`}>{plugin.kind}</span>
      </div>
      <p className="break-words text-sm text-text-muted">{plugin.description}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        <div><dt className="text-text-muted">Status</dt><dd className="font-semibold text-ok-text">registered</dd></div>
        <div><dt className="text-text-muted">Canvas target</dt><dd className="break-all font-mono text-text">{target}</dd></div>
        <div><dt className="text-text-muted">Runtime hook</dt><dd className="break-all font-mono text-text">{'renderer' in plugin ? plugin.renderer : plugin.mount}</dd></div>
        {'apiPath' in plugin && plugin.apiPath ? <div><dt className="text-text-muted">Data API</dt><dd className="break-all font-mono text-text">{plugin.apiPath}</dd></div> : null}
      </dl>
      <a className="focus-ring mt-4 inline-flex rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:bg-ok-bg" href={target}>Open canvas</a>
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
    <section className="grid w-full min-w-0 gap-5" aria-labelledby="canvas-plugins-title">
      <header className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Canvas plugins</p>
        <h1 id="canvas-plugins-title" className="mt-2 text-3xl font-semibold text-text">Canvas plugin registry</h1>
        <p className="mt-2 text-sm text-text-muted">Filter the standalone registry by runtime while keeping canvas.buildwithoracle.com targets visible.</p>
        <p className="mt-2 font-mono text-xs text-text-muted">Registry endpoint: {endpointHint}</p>
        <p className="mt-3 inline-flex rounded-full border border-border px-3 py-2 text-sm text-text-muted">{summary}</p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Canvas plugin runtime filters">
          {filterOptions.map((option) => (
            <button
              key={option.kind}
              aria-pressed={kindFilter === option.kind}
              className={`focus-ring rounded-xl border px-3 py-2 text-left text-sm ${kindFilter === option.kind ? 'border-accent-border bg-ok-bg text-accent' : 'border-border text-text-muted hover:border-accent-border'}`}
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
      {state !== 'error' && plugins.length ? <div className="grid min-w-0 gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]">{plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} host={host} />)}</div> : null}
      {state === 'ready' && !plugins.length ? <p className="rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-5 text-sm text-text-muted">No canvas plugins match this filter.</p> : null}
    </section>
  );
}
