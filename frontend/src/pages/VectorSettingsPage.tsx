import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import {
  type LoadState,
  type VectorConfigResponse,
  type VectorConfigRow,
  fetchJson,
  parseVectorConfigResponse,
  toRows,
} from './vectorSettingsHelpers';

type Provider = {
  type: string;
  available: boolean;
  status?: string;
  models?: string[];
  error?: string;
};

type IndexModel = {
  collection: string;
  model: string;
  adapter: string;
  count?: number;
};

type IndexStatus = {
  model: string;
  status: 'idle' | 'indexing' | 'completed' | 'error';
  current: number;
  total: number;
  startedAt: number;
  completedAt?: number;
  docsPerSec: number;
  eta: number;
  error?: string;
};

type CacheStats = { size?: number; hits?: number; misses?: number };

function dateLabel(value?: number | string): string {
  if (!value) return 'not recorded';
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : String(value);
}

function countFor(row: VectorConfigRow, models: Record<string, IndexModel>): number {
  return row.count ?? models[row.key]?.count ?? 0;
}

function providerDetail(provider: Provider): string {
  if (provider.error) return provider.error;
  const models = provider.models?.slice(0, 2).join(', ') || 'no models reported';
  return `${provider.status ?? (provider.available ? 'available' : 'unavailable')} · ${models}`;
}

function statusText(status: IndexStatus | null): string {
  if (!status || status.status === 'idle') return 'No active index job.';
  if (status.status === 'completed') return `Completed ${status.model}`;
  if (status.status === 'error') return status.error ?? `Failed ${status.model}`;
  return `${status.model}: ${status.current}/${status.total} docs · ${status.docsPerSec} docs/sec`;
}

export function VectorSettingsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [config, setConfig] = useState<VectorConfigResponse | null>(null);
  const [rows, setRows] = useState<VectorConfigRow[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Record<string, IndexModel>>({});
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [busy, setBusy] = useState('');

  const primary = useMemo(() => rows.find((row) => row.primary) ?? rows[0], [rows]);
  const provider = providers.find((item) => item.type === selectedProvider);
  const availableModels = provider?.models ?? [];
  const totalDocs = rows.reduce((sum, row) => sum + countFor(row, models), 0);
  const lastIndexed = indexStatus?.completedAt ?? indexStatus?.startedAt ?? config?.checked_at;

  async function load() {
    setState('loading');
    setError('');
    try {
      const [configBody, providersBody, modelsBody, statusBody] = await Promise.all([
        fetchJson<VectorConfigResponse>('/api/v1/vector/config'),
        fetchJson<{ providers?: Provider[] }>('/api/v1/vector/providers'),
        fetchJson<{ models?: Record<string, IndexModel> }>('/api/v1/vector/index/models'),
        fetchJson<IndexStatus>('/api/v1/vector/index/status'),
      ]);
      const parsed = parseVectorConfigResponse(configBody);
      const nextRows = toRows(parsed);
      const nextProviders = providersBody.providers ?? [];
      setConfig(parsed);
      setRows(nextRows);
      setProviders(nextProviders);
      setModels(modelsBody.models ?? {});
      setIndexStatus(statusBody);
      setSelectedProvider((current) => current || nextProviders.find((item) => item.available)?.type || nextProviders[0]?.type || '');
      setSelectedModel((current) => current || nextRows.find((row) => row.primary)?.model || nextRows[0]?.model || '');
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  }

  useEffect(() => { void load(); }, []);

  async function runAction(label: string, action: () => Promise<string>) {
    setBusy(label);
    setMessage('');
    setError('');
    try {
      setMessage(await action());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }

  const applyModel = () => runAction('apply-model', async () => {
    if (!primary) return 'No primary collection is available.';
    await fetchJson(`/api/v1/vector/config/${encodeURIComponent(primary.key)}`, {
      method: 'PUT',
      body: JSON.stringify({ provider: selectedProvider, model: selectedModel }),
    });
    await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
    return `Applied ${selectedProvider}/${selectedModel} to ${primary.key}.`;
  });

  const reindex = () => runAction('reindex', async () => {
    const key = primary?.key ?? 'bge-m3';
    await fetchJson('/api/v1/vector/index/start', { method: 'POST', body: JSON.stringify({ model: key }) });
    return `Started re-index for ${key}.`;
  });

  const clearCache = () => runAction('clear-cache', async () => {
    const result = await fetchJson<{ cache?: CacheStats }>('/api/v1/vector/fanout/cache', { method: 'DELETE' });
    return `Cleared query cache; ${result.cache?.size ?? 0} entries remain.`;
  });

  return (
    <section className="grid gap-5" aria-labelledby="vector-settings-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector settings</p>
        <h1 id="vector-settings-title" className="mt-2 text-3xl font-semibold text-white">Vector settings</h1>
        <p className="mt-2 text-sm text-slate-400">Configure adapters, embedding models, indexing state, and query cache controls.</p>
      </header>

      {state === 'loading' ? <LoadingPanel title="Loading vector settings" detail="Fetching config, providers, and index status." /> : null}
      {error ? <ErrorMessage title="Vector settings failed." message={error} /> : null}
      {message ? <p className="rounded-xl border border-teal-300/20 bg-teal-300/10 p-3 text-sm text-teal-100">{message}</p> : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <BentoCard eyebrow="Active adapters" title="Configured collections">
          <div className="grid gap-3">
            {rows.map((row) => (
              <article key={row.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-mono text-sm font-semibold text-white">{row.key}</h2>
                    <p className="mt-1 text-sm text-slate-400">{row.adapter} · {row.provider} · {countFor(row, models).toLocaleString()} docs</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.health?.ok ? 'bg-teal-300/15 text-teal-100' : 'bg-red-300/15 text-red-100'}`}>
                    {row.health?.status ?? 'unknown'}
                  </span>
                </div>
              </article>
            ))}
            {!rows.length && state === 'ready' ? <p className="text-sm text-slate-500">No vector collections configured.</p> : null}
          </div>
        </BentoCard>

        <BentoCard eyebrow="Embedding model" title="Provider selector">
          <div className="grid gap-3">
            <label className="text-sm font-semibold text-slate-300">Provider<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" value={selectedProvider} onChange={(event) => { const next = event.target.value; setSelectedProvider(next); setSelectedModel(providers.find((item) => item.type === next)?.models?.[0] ?? ''); }}>
              {providers.map((item) => <option key={item.type} value={item.type}>{item.type}</option>)}
            </select></label>
            <label className="text-sm font-semibold text-slate-300">Model<select className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {[selectedModel, ...availableModels].filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).map((model) => <option key={model} value={model}>{model}</option>)}
            </select></label>
            <p className="text-sm text-slate-400">{provider ? providerDetail(provider) : 'Provider detection has not returned data.'}</p>
            <button className="focus-ring rounded-xl bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={!primary || !selectedProvider || !selectedModel || Boolean(busy)} type="button" onClick={() => void applyModel()}>
              {busy === 'apply-model' ? <Spinner label="Applying" /> : `Apply to ${primary?.key ?? 'primary'}`}
            </button>
          </div>
        </BentoCard>

        <BentoCard eyebrow="Index status" title="Collections and progress">
          <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <Stat label="Collections" value={rows.length.toLocaleString()} />
            <Stat label="Documents" value={totalDocs.toLocaleString()} />
            <Stat label="Last index" value={dateLabel(lastIndexed)} />
          </dl>
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">{statusText(indexStatus)}</p>
        </BentoCard>

        <BentoCard eyebrow="Quick actions" title="Maintenance controls">
          <div className="grid gap-3 sm:grid-cols-3">
            <ActionButton disabled={Boolean(busy)} label="Refresh" loading={busy === 'refresh'} onClick={() => void runAction('refresh', async () => 'Refreshed vector settings.')} />
            <ActionButton disabled={Boolean(busy) || indexStatus?.status === 'indexing'} label="Re-index" loading={busy === 'reindex'} onClick={() => void reindex()} />
            <ActionButton disabled={Boolean(busy)} label="Clear cache" loading={busy === 'clear-cache'} onClick={() => void clearCache()} />
          </div>
          <p className="mt-4 text-sm text-slate-400">Re-index targets {primary?.key ?? 'the primary collection'}; cache clearing uses /api/v1/vector/fanout/cache.</p>
        </BentoCard>
      </div>
    </section>
  );
}

function BentoCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-white">{value}</dd></div>;
}

function ActionButton({ disabled, label, loading, onClick }: { disabled: boolean; label: string; loading: boolean; onClick: () => void }) {
  return (
    <button className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-teal-300/40 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={onClick}>
      {loading ? <Spinner label={label} /> : label}
    </button>
  );
}
