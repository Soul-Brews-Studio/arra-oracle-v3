import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, type ApiClient, type VectorHealthResponse, type VectorIndexModelEntry, type VectorIndexModelsResponse } from '../api/client';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { VectorSearchWidget } from '../components/VectorSearchWidget';
import { vectorDocumentsPath, vectorSearchPath } from '../routePaths';

type PageState = 'loading' | 'ready' | 'error';
type VectorStatusClient = Pick<ApiClient, 'vectorIndexModels' | 'vectorHealth'>;
export type VectorExportFormat = 'json' | 'csv';
type DownloadByCollection = Record<string, VectorExportFormat | undefined>;
type ExportFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
type SaveBlob = (blob: Blob, filename: string) => void | Promise<void>;
export interface VectorCollectionCard {
  key: string;
  collection: string;
  adapter: string;
  model: string;
  count?: number;
  healthy: boolean;
  healthLabel: string;
  healthDetail?: string;
}

export interface VectorPageProps {
  modelsResponse?: VectorIndexModelsResponse | null;
  healthResponse?: VectorHealthResponse | null;
  loading?: boolean;
  client?: VectorStatusClient;
}

function healthFor(key: string, model: VectorIndexModelEntry, health?: VectorHealthResponse | null) {
  return health?.engines.find((engine) => (
    engine.key === key || engine.collection === model.collection || engine.model === model.model
  ));
}

function healthLabel(healthy: boolean, error?: string): string {
  if (healthy) return 'Healthy';
  return error ? 'Down' : 'Unavailable';
}

export function buildVectorCollectionCards(
  modelsResponse?: VectorIndexModelsResponse | null,
  healthResponse?: VectorHealthResponse | null,
): VectorCollectionCard[] {
  const models = modelsResponse?.models ?? {};
  return Object.entries(models)
    .map(([key, model]) => {
      const engine = healthFor(key, model, healthResponse);
      const healthy = engine ? engine.ok !== false : healthResponse?.status === 'ok';
      const detail = engine?.error ?? healthResponse?.error;
      return {
        key,
        collection: model.collection,
        adapter: model.adapter || 'lancedb',
        model: model.model,
        count: model.count,
        healthy,
        healthLabel: healthLabel(healthy, detail),
        healthDetail: detail,
      };
    })
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

export function vectorDashboardSummary(cards: VectorCollectionCard[], state: PageState): string {
  if (state === 'loading') return 'Loading vector collections…';
  if (state === 'error' && cards.length === 0) return 'Vector status is unavailable.';
  if (cards.length === 0) return 'No vector collections are registered.';
  const healthy = cards.filter((card) => card.healthy).length;
  return `${healthy}/${cards.length} vector collections healthy.`;
}

export function vectorExportPath(collection: string, format: VectorExportFormat): string {
  return `/api/vector/export?${new URLSearchParams({ collection, format }).toString()}`;
}

export function vectorExportFilename(collection: string, format: VectorExportFormat): string {
  const safeName = collection.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'collection';
  return `${safeName}.${format}`;
}

export function saveBlobAsDownload(blob: Blob, filename: string): void {
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) throw new Error('Browser downloads are unavailable');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body?.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadVectorCollection(
  collection: string,
  format: VectorExportFormat,
  deps: { fetch?: ExportFetch; saveBlob?: SaveBlob } = {},
): Promise<void> {
  const fetcher = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new Error('fetch is unavailable');
  const response = await fetcher(vectorExportPath(collection, format), {
    headers: { accept: format === 'json' ? 'application/json' : 'text/csv' },
  });
  if (!response.ok) throw new Error(`/api/vector/export returned ${response.status}`);
  await (deps.saveBlob ?? saveBlobAsDownload)(await response.blob(), vectorExportFilename(collection, format));
}

function docCountLabel(count?: number): string {
  if (typeof count !== 'number') return 'unknown docs';
  return `${count.toLocaleString()} doc${count === 1 ? '' : 's'}`;
}

function statusClasses(healthy: boolean): string {
  return healthy
    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
    : 'border-red-300/30 bg-red-300/10 text-red-100';
}

export function VectorCollectionCards({
  cards,
  downloads = {},
  onExport,
}: {
  cards: VectorCollectionCard[];
  downloads?: DownloadByCollection;
  onExport?: (collection: string, format: VectorExportFormat) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Vector collections">
      {cards.map((card) => {
        const downloading = downloads[card.collection];
        const disabled = Boolean(downloading);
        return (
          <article key={card.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Collection</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{card.collection}</h2>
              </div>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(card.healthy)}`}>
                {card.healthLabel}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <div><dt className="text-slate-500">Adapter</dt><dd className="font-medium text-slate-100">{card.adapter}</dd></div>
              <div><dt className="text-slate-500">Model</dt><dd className="font-medium text-slate-100">{card.model}</dd></div>
              <div><dt className="text-slate-500">Documents</dt><dd className="font-medium text-slate-100">{docCountLabel(card.count)}</dd></div>
            </dl>
            {card.healthDetail ? <p className="mt-3 text-xs text-red-200">{card.healthDetail}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="focus-ring rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={() => onExport?.(card.collection, 'json')}>
                {downloading === 'json' ? <Spinner label="Downloading JSON" /> : 'Export JSON'}
              </button>
              <button className="focus-ring rounded-xl border border-purple-300/30 px-3 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-300/10 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={() => onExport?.(card.collection, 'csv')}>
                {downloading === 'csv' ? <Spinner label="Downloading CSV" /> : 'Export CSV'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function VectorDocumentsCard() {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-documents-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Documents</p>
      <h2 id="vector-documents-title" className="mt-2 text-2xl font-semibold text-white">Browse indexed documents</h2>
      <p className="mt-2 text-sm text-slate-400">Open the collection-level document browser for full content and metadata.</p>
      <Link className="focus-ring mt-4 inline-flex rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" to={vectorDocumentsPath()}>
        Open document browser
      </Link>
    </section>
  );
}

export function VectorPage({ modelsResponse = null, healthResponse = null, loading = true, client = apiClient }: VectorPageProps) {
  const navigate = useNavigate();
  const [models, setModels] = useState(modelsResponse);
  const [health, setHealth] = useState(healthResponse);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [downloads, setDownloads] = useState<DownloadByCollection>({});
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    Promise.all([client.vectorIndexModels(), client.vectorHealth()])
      .then(([nextModels, nextHealth]) => {
        if (cancelled) return;
        setModels(nextModels);
        setHealth(nextHealth);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState(models ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client]);

  async function onExport(collection: string, format: VectorExportFormat) {
    setDownloadError('');
    setDownloads((current) => ({ ...current, [collection]: format }));
    try {
      await downloadVectorCollection(collection, format);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloads(({ [collection]: _done, ...rest }) => rest);
    }
  }

  const cards = useMemo(() => buildVectorCollectionCards(models, health), [models, health]);
  const summary = vectorDashboardSummary(cards, state);
  const isLoading = state === 'loading';

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-status-title">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector status</p>
            <h1 id="vector-status-title" className="mt-2 text-3xl font-semibold text-white">Vector dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">Collection health from /api/vector/index/models and /api/vector/health.</p>
          </div>
          <p className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
        </div>

        {isLoading ? <LoadingPanel title="Loading vector status…" detail="Fetching /api/vector/index/models and /api/vector/health." /> : null}
        {state === 'error' ? <ErrorMessage title="Could not load vector status." message={error} /> : null}
        {downloadError ? <div className="mb-4"><ErrorMessage title="Vector export failed." message={downloadError} /></div> : null}
        {!isLoading && state !== 'error' && cards.length === 0 ? <p className="text-sm text-slate-400">No vector collections are registered.</p> : null}
        {cards.length ? <VectorCollectionCards cards={cards} downloads={downloads} onExport={onExport} /> : null}
      </section>

      <VectorDocumentsCard />
      <VectorSearchWidget onOpenResults={(query) => navigate(vectorSearchPath(query))} />
      <VectorIndexPanel />
    </div>
  );
}
