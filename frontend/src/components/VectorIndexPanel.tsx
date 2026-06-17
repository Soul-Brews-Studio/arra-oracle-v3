import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiClient,
  type ApiClient,
  type VectorIndexCollection,
  type VectorIndexStatusResponse,
} from '../api/client';
import { ErrorMessage, LoadingPanel, Spinner } from './AsyncState';
import { VectorIndexCostPanel, type VectorCostEstimate, type VectorCostTracking } from './VectorIndexCostPanel';

type VectorIndexClient = Pick<ApiClient, 'startVectorIndex' | 'vectorIndexModels' | 'vectorIndexStatus'>;

interface VectorIndexPanelProps {
  client?: VectorIndexClient;
  initialModels?: Record<string, VectorIndexCollection>;
  initialStatus?: VectorIndexStatusResponse | null;
  initialCostEstimate?: VectorCostEstimate | null;
  initialCostTracking?: VectorCostTracking | null;
  loadCostEstimate?: () => Promise<VectorCostEstimate>;
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

function totalVectors(models: Record<string, VectorIndexCollection>): number {
  return Object.values(models).reduce((sum, model) => sum + (model.count ?? 0), 0);
}

function gapLabel(models: Record<string, VectorIndexCollection>, status: VectorIndexStatusResponse | null): string {
  if (status?.total && status.total > status.current) return `${(status.total - status.current).toLocaleString()} docs need backfill`;
  const total = totalVectors(models);
  if (!total) return 'Source docs need first vector backfill.';
  return '0 docs need backfill';
}

function statusSummary(status: VectorIndexStatusResponse | null): string {
  if (!status || status.status === 'idle') return 'No active index job.';
  if (status.status === 'completed') return `Completed ${status.model} reindex.`;
  if (status.status === 'error') return `Failed ${status.model} reindex.`;
  if (status.status === 'stopped') return `Stopped ${status.model} reindex.`;
  if (status.status === 'stopping') return `Stopping ${status.model} reindex...`;
  return `⏳ Backfilling ${status.model}... ${status.current.toLocaleString()}/${status.total.toLocaleString()} (${progressFor(status)}%)`;
}

function jobNotice(status: VectorIndexStatusResponse | null): { title: string; detail: string; tone: string } | null {
  if (!status || status.status === 'idle' || status.status === 'indexing' || status.status === 'stopping') return null;
  if (status.status === 'completed') return {
    title: 'Index job complete',
    detail: `${status.model} indexed ${status.current.toLocaleString()}/${status.total.toLocaleString()} docs. Dashboard vectors are ready.`,
    tone: 'border-ok-border bg-ok-bg text-ok-text',
  };
  if (status.status === 'stopped') return {
    title: 'Index job stopped',
    detail: status.error ?? `${status.model} stopped at ${status.current.toLocaleString()}/${status.total.toLocaleString()} docs.`,
    tone: 'border-warn-border bg-warn-bg text-warn-text',
  };
  return {
    title: 'Index job failed',
    detail: status.error ?? `${status.model} failed before completing the vector backfill.`,
    tone: 'border-err-border bg-err-bg text-err-text',
  };
}

function modelState(model: VectorIndexCollection): string {
  return (model.count ?? 0) > 0 ? 'synced' : 'stale';
}

function vaultState(model: VectorIndexCollection): string {
  return (model.count ?? 0) > 0 ? 'indexed' : 'not indexed';
}

export function VectorIndexPanel({
  client = apiClient,
  initialModels,
  initialStatus = null,
  initialCostEstimate,
  initialCostTracking,
  loadCostEstimate,
}: VectorIndexPanelProps) {
  const [models, setModels] = useState<Record<string, VectorIndexCollection>>(initialModels ?? {});
  const [loading, setLoading] = useState(!initialModels);
  const [status, setStatus] = useState<VectorIndexStatusResponse | null>(initialStatus);
  const [error, setError] = useState('');
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const modelEntries = useMemo(() => Object.entries(models).sort(([a], [b]) => a.localeCompare(b)), [models]);
  const indexing = status?.status === 'indexing' || status?.status === 'stopping';
  const notice = jobNotice(status);
  const firstModel = modelEntries[0]?.[0];

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

  const startFirstModel = () => {
    if (firstModel) void startReindex(firstModel);
  };

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-index-title">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Index Manager</p>
          <h2 id="vector-index-title" className="mt-2 text-2xl font-semibold text-text">Index jobs and collections</h2>
          <p className="mt-2 text-sm text-text-muted">Start, poll, and audit embedding rebuilds through /api/v1/vector/index/start.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="focus-ring rounded-xl bg-accent2-solid px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={!firstModel || indexing || Boolean(startingKey)} type="button" onClick={startFirstModel}>Index Now</button>
          <button className="focus-ring rounded-xl border border-accent2-border px-3 py-2 text-sm font-semibold text-accent2 disabled:opacity-50" disabled={!firstModel || indexing || Boolean(startingKey)} type="button" onClick={startFirstModel}>Backfill Vectors</button>
          <a className="focus-ring rounded-xl border border-border px-3 py-2 text-sm text-text hover:border-purple-300/40" href="/settings">Add Vault</a>
          <button className="focus-ring rounded-xl border border-border px-3 py-2 text-sm text-text hover:border-purple-300/40" type="button" onClick={() => void refreshStatus()}>Refresh status</button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-surface-muted p-4">
        <p className="text-sm font-semibold text-text">Active jobs: {statusSummary(status)}</p>
        <p className="mt-1 text-sm text-warn-text">Gap indicator: {gapLabel(models, status)}</p>
        {status ? <IndexProgress status={status} /> : null}
      </div>

      {notice ? (
        <div className={`mb-4 rounded-2xl border p-4 text-sm ${notice.tone}`} role="status" aria-live="polite">
          <p className="font-semibold"><span aria-hidden="true">● </span>{notice.title}</p>
          <p className="mt-1 opacity-80">{notice.detail}</p>
        </div>
      ) : null}

      <VectorIndexCostPanel indexing={indexing} initialCostEstimate={initialCostEstimate} initialCostTracking={initialCostTracking} loadCostEstimate={loadCostEstimate} />

      {loading ? <LoadingPanel title="Loading vector collections…" detail="Fetching /api/v1/vector/index/models." /> : null}
      {error ? <ErrorMessage title="Vector indexing failed." message={error} /> : null}
      {!loading && !modelEntries.length ? <p className="text-sm text-text-muted">No vector collections reported.</p> : null}

      <section className="mb-5 rounded-2xl border border-border bg-surface-muted p-4" aria-label="Vault list">
        <h3 className="font-semibold text-accent">Vault list</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {modelEntries.map(([key, model]) => (
            <p key={key} className="rounded-xl border border-border bg-field/50 p-3 text-sm text-text-muted">
              <span className="font-mono text-accent">{model.collection}</span><br />
              {(model.count ?? 0).toLocaleString()} docs · {vaultState(model)}
            </p>
          ))}
        </div>
      </section>

      <h3 className="mb-3 font-semibold text-accent2">Vector Models</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {modelEntries.map(([key, model]) => {
          const active = indexing && status?.model === key;
          return (
            <article key={key} className="rounded-2xl border border-border bg-surface-muted p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-mono text-base font-semibold text-accent">{key}</h3>
                  <p className="mt-1 text-sm text-text-muted">{model.collection}</p>
                </div>
                <button
                  className="focus-ring rounded-xl bg-accent2-solid px-3 py-2 text-sm font-semibold text-on-accent hover:bg-accent2-hover disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(startingKey) || indexing}
                  type="button"
                  onClick={() => void startReindex(key)}
                >
                  {startingKey === key ? <Spinner label="Starting" /> : active ? 'Reindexing…' : 'Reindex'}
                </button>
              </div>
              <dl className="mt-4 grid gap-2 text-sm text-text-muted">
                <div><dt className="inline text-text-muted">Model: </dt><dd className="inline">{model.model}</dd></div>
                <div><dt className="inline text-text-muted">Adapter: </dt><dd className="inline">{model.adapter}</dd></div>
                <div><dt className="inline text-text-muted">Docs: </dt><dd className="inline">{model.count ?? 0}</dd></div>
                <div><dt className="inline text-text-muted">Sync: </dt><dd className="inline">{modelState(model)}</dd></div>
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
        <div className="h-full rounded-full bg-accent2-solid transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-sm text-text-muted">
        {status.current}/{status.total} docs · {status.docsPerSec} docs/sec · ETA {formatIndexEta(status.eta)}
      </p>
      {status.error ? <p className="mt-2 text-sm text-err-text">{status.error}</p> : null}
    </div>
  );
}
