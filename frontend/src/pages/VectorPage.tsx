import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, type ApiClient, type VectorHealthResponse, type VectorIndexModelEntry, type VectorIndexModelsResponse } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { VectorSearchWidget } from '../components/VectorSearchWidget';
import { vectorDocumentsPath, vectorSearchPath } from '../routePaths';
import {
  downloadVectorCollection,
  fallbackVectorExportFormats,
  fetchVectorExportFormats,
  type VectorExportFormat,
} from '../vectorExport';
import {
  VectorCollectionCards,
  VectorStatsCard,
  QuickExportCard,
  VectorHealthDashboardCard,
  type VectorCollectionCard,
  type VectorFreshnessCard,
  type VectorProviderHealthCard,
  type VectorStorageHealthCard,
} from './vector-dashboard-cards';

type PageState = 'loading' | 'ready' | 'error';
type VectorStatusClient = Pick<ApiClient, 'vectorIndexModels' | 'vectorHealth'>;
type DownloadByCollection = Record<string, VectorExportFormat | undefined>;
type VectorDashboardHealth = VectorHealthResponse & { providers?: VectorProviderHealthCard[]; freshness?: VectorFreshnessCard; storage?: VectorStorageHealthCard[] };

export interface VectorPageProps {
  modelsResponse?: VectorIndexModelsResponse | null;
  healthResponse?: VectorHealthResponse | null;
  loading?: boolean;
  client?: VectorStatusClient;
}

function healthFor(key: string, model: VectorIndexModelEntry, health?: VectorHealthResponse | null) {
  return health?.engines.find((engine) => engine.key === key || engine.collection === model.collection || engine.model === model.model);
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

export function VectorPage({
  modelsResponse = null,
  healthResponse = null,
  loading = true,
  client = apiClient,
}: VectorPageProps) {
  const navigate = useNavigate();
  const [models, setModels] = useState(modelsResponse);
  const [health, setHealth] = useState(healthResponse);
  const [state, setState] = useState<PageState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloads, setDownloads] = useState<DownloadByCollection>({});
  const [formats, setFormats] = useState(fallbackVectorExportFormats);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    Promise.all([client.vectorIndexModels(), client.vectorHealth(), fetchVectorExportFormats()])
      .then(([nextModels, nextHealth, nextFormats]) => {
        if (cancelled) return;
        setModels(nextModels);
        setHealth(nextHealth);
        setFormats(nextFormats.length ? nextFormats : fallbackVectorExportFormats);
        setState('ready');
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState(models ? 'ready' : 'error');
      });
    return () => { cancelled = true; };
  }, [client]);

  async function onExport(collection: string, format: VectorExportFormat) {
    setDownloadError('');
    setDownloads((current) => ({ ...current, [collection]: format }));
    try {
      await downloadVectorCollection(collection, format);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDownloads((current) => {
        const next = { ...current };
        delete next[collection];
        return next;
      });
    }
  }

  const cards = useMemo(() => buildVectorCollectionCards(models, health), [models, health]);
  const dashboardHealth = health as VectorDashboardHealth | null;
  const summary = vectorDashboardSummary(cards, state);
  const isLoading = state === 'loading';

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-status-title">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector status</p>
            <h1 id="vector-status-title" className="mt-2 text-3xl font-semibold text-white">Vector dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">Collection health from /api/v1/vector/index/models and /api/v1/vector/health.</p>
          </div>
          <p className="rounded-full border border-white/10 px-3 py-2 text-sm text-slate-300">{summary}</p>
        </div>

        {isLoading ? <LoadingPanel title="Loading vector status…" detail="Fetching /api/v1/vector/index/models and /api/v1/vector/health." /> : null}
        {state === 'error' ? <ErrorMessage title="Could not load vector status." message={error} /> : null}
        {downloadError ? <div className="mb-4"><ErrorMessage title="Vector export failed." message={downloadError} /></div> : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-label="Vector dashboard cards">
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Collection health</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Vector collections</h2>
          <p className="mt-2 text-sm text-slate-400">Status, model, and adapter details by collection.</p>
          {!isLoading && state !== 'error' && cards.length === 0 ? <p className="mt-4 text-sm text-slate-400">No vector collections are registered.</p> : null}
          {cards.length ? <VectorCollectionCards cards={cards} formats={formats} downloads={downloads} onExport={onExport} /> : null}
        </section>

        <div className="grid gap-4">
          <VectorStatsCard cards={cards} />
          <VectorHealthDashboardCard providers={dashboardHealth?.providers} storage={dashboardHealth?.storage} freshness={dashboardHealth?.freshness} />
          <QuickExportCard cards={cards} formats={formats} downloads={downloads} onExport={onExport} />
          <VectorIndexPanel />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <VectorSearchWidget onOpenResults={(query) => navigate(vectorSearchPath(query))} />
        <VectorDocumentsCard />
      </section>

    </div>
  );
}

export { VectorCollectionCards, type VectorCollectionCard, VectorStatsCard, QuickExportCard };
