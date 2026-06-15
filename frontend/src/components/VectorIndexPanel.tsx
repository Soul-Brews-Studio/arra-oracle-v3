import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiClient,
  type ApiClient,
  type VectorIndexCollection,
  type VectorIndexStatusResponse,
} from '../api/client';
import { ErrorMessage, LoadingPanel, Spinner } from './AsyncState';

type VectorIndexClient = Pick<ApiClient, 'startVectorIndex' | 'vectorIndexModels' | 'vectorIndexStatus'>;

interface VectorIndexPanelProps {
  client?: VectorIndexClient;
  initialModels?: Record<string, VectorIndexCollection>;
  initialStatus?: VectorIndexStatusResponse | null;
}

export function formatIndexEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'calculating';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function progressFor(status: VectorIndexStatusResponse): number {
  if (status.total <= 0) return status.status === 'completed' ? 100 : 0;
  return Math.min(100, Math.round((status.current / status.total) * 100));
}

function statusSummary(status: VectorIndexStatusResponse | null): string {
  if (!status || status.status === 'idle') return 'No active index job.';
  if (status.status === 'completed') return `Completed ${status.model} reindex.`;
  if (status.status === 'error') return `Failed ${status.model} reindex.`;
  return `Indexing ${status.model}; polling every 2s.`;
}

export function VectorIndexPanel({ client = apiClient, initialModels, initialStatus = null }: VectorIndexPanelProps) {
  const [models, setModels] = useState<Record<string, VectorIndexCollection>>(initialModels ?? {});
  const [loading, setLoading] = useState(!initialModels);
  const [status, setStatus] = useState<VectorIndexStatusResponse | null>(initialStatus);
  const [error, setError] = useState('');
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const modelEntries = useMemo(() => Object.entries(models).sort(([a], [b]) => a.localeCompare(b)), [models]);
  const indexing = status?.status === 'indexing';

  const refreshStatus = useCallback(async () => {
    const next = await client.vectorIndexStatus();
    setStatus(next);
    return next;
  }, [client]);

  useEffect(() => {
    if (initialModels) return;
    let active = true;
    setLoading(true);
    client.vectorIndexModels()
      .then((response) => { if (active) setModels(response.models); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, initialModels]);

  useEffect(() => {
    let active = true;
    client.vectorIndexStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!indexing || typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      refreshStatus().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [indexing, refreshStatus]);

  async function startReindex(key: string) {
    setStartingKey(key);
    setError('');
    try {
      await client.startVectorIndex(key);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStartingKey(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-index-title">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Index management</p>
          <h2 id="vector-index-title" className="mt-2 text-2xl font-semibold text-white">Vector collections</h2>
          <p className="mt-2 text-sm text-slate-400">Rebuild each embedding collection through /api/vector/index/start.</p>
        </div>
        <button
          className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-purple-300/40"
          type="button"
          onClick={() => void refreshStatus()}
        >
          Refresh status
        </button>
      </div>

      <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm font-semibold text-slate-200">{statusSummary(status)}</p>
        {status ? <IndexProgress status={status} /> : null}
      </div>

      {loading ? <LoadingPanel title="Loading vector collections…" detail="Fetching /api/vector/index/models." /> : null}
      {error ? <ErrorMessage title="Vector indexing failed." message={error} /> : null}
      {!loading && !modelEntries.length ? <p className="text-sm text-slate-500">No vector collections reported.</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {modelEntries.map(([key, model]) => {
          const active = indexing && status?.model === key;
          return (
            <article key={key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-mono text-base font-semibold text-teal-200">{key}</h3>
                  <p className="mt-1 text-sm text-slate-300">{model.collection}</p>
                </div>
                <button
                  className="focus-ring rounded-xl bg-purple-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-purple-200 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(startingKey) || indexing}
                  type="button"
                  onClick={() => void startReindex(key)}
                >
                  {startingKey === key ? <Spinner label="Starting" /> : active ? 'Reindexing…' : 'Reindex'}
                </button>
              </div>
              <dl className="mt-4 grid gap-2 text-sm text-slate-400">
                <div><dt className="inline text-slate-500">Model: </dt><dd className="inline">{model.model}</dd></div>
                <div><dt className="inline text-slate-500">Adapter: </dt><dd className="inline">{model.adapter}</dd></div>
                <div><dt className="inline text-slate-500">Docs: </dt><dd className="inline">{model.count ?? 0}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function IndexProgress({ status }: { status: VectorIndexStatusResponse }) {
  const progress = progressFor(status);
  return (
    <div className="mt-3">
      <div className="h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-purple-300 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        {status.current}/{status.total} docs · {status.docsPerSec} docs/sec · ETA {formatIndexEta(status.eta)}
      </p>
      {status.error ? <p className="mt-2 text-sm text-red-200">{status.error}</p> : null}
    </div>
  );
}
