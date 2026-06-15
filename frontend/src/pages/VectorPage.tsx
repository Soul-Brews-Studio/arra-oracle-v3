import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient, type ApiClient, type VectorHealthResponse, type VectorIndexModelEntry, type VectorIndexModelsResponse } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { VectorSearchWidget } from '../components/VectorSearchWidget';
import { vectorDocumentsPath, vectorResultsPath } from '../routePaths';

type PageState = 'loading' | 'ready' | 'error';
type VectorStatusClient = Pick<ApiClient, 'vectorIndexModels' | 'vectorHealth'>;

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

function docCountLabel(count?: number): string {
  if (typeof count !== 'number') return 'unknown docs';
  return `${count.toLocaleString()} doc${count === 1 ? '' : 's'}`;
}

function statusClasses(healthy: boolean): string {
  return healthy
    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
    : 'border-red-300/30 bg-red-300/10 text-red-100';
}

function VectorCollectionCards({ cards }: { cards: VectorCollectionCard[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Vector collections">
      {cards.map((card) => (
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
            <div>
              <dt className="text-slate-500">Adapter</dt>
              <dd className="font-medium text-slate-100">{card.adapter}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Model</dt>
              <dd className="font-medium text-slate-100">{card.model}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Documents</dt>
              <dd className="font-medium text-slate-100">{docCountLabel(card.count)}</dd>
            </div>
          </dl>
          {card.healthDetail ? <p className="mt-3 text-xs text-red-200">{card.healthDetail}</p> : null}
        </article>
      ))}
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
        {!isLoading && state !== 'error' && cards.length === 0 ? <p className="text-sm text-slate-400">No vector collections are registered.</p> : null}
        {cards.length ? <VectorCollectionCards cards={cards} /> : null}
      </section>

      <VectorDocumentsCard />
      <VectorSearchWidget onOpenResults={(query) => navigate(vectorResultsPath(query))} />
    </div>
  );
}
