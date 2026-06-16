import { useEffect, useMemo, useState } from 'react';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import {
  ADAPTER_OPTIONS,
  type LoadState,
  type VectorCollectionTest,
  type VectorConfigDraft,
  type VectorConfigResponse,
  type VectorConfigRow,
  type VectorConfigAdapter,
  fetchJson,
  parseVectorConfigResponse,
  toRows,
} from './vectorSettingsHelpers';

function CollectionStatus({ status }: { status?: VectorConfigRow['health'] }) {
  if (!status) return <p className="text-xs text-slate-400">No health yet.</p>;
  const tone = status.ok ? 'text-emerald-200' : 'text-red-200';
  const border = status.ok ? 'border-emerald-300/40 bg-emerald-300/10' : 'border-red-300/40 bg-red-300/10';
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${tone} ${border}`}>{status.status}</span>;
}

export function VectorSettingsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<VectorConfigResponse | null>(null);
  const [rows, setRows] = useState<VectorConfigRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VectorConfigDraft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<Record<string, string>>({});
  const [reloading, setReloading] = useState(false);
  const [reloadStatus, setReloadStatus] = useState('');

  async function loadConfig() {
    setState('loading');
    setError('');
    try {
      const response = await fetchJson<VectorConfigResponse>('/api/v1/vector/config');
      const normalized = parseVectorConfigResponse(response);
      const nextRows = toRows(normalized);
      setConfig(normalized);
      setRows(nextRows);
      const nextDrafts: Record<string, VectorConfigDraft> = {};
      for (const row of nextRows) {
        nextDrafts[row.key] = { model: row.model, provider: row.provider, adapter: row.adapter };
      }
      setDrafts(nextDrafts);
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  const stats = useMemo(() => {
    if (!rows.length || !config) return 'No vector collections loaded.';
    const healthy = rows.filter((item) => item.health?.ok).length;
    return `${rows.length} collections · ${healthy}/${rows.length} healthy · source ${config.source}`;
  }, [rows, config]);

  function updateDraft(key: string, next: Partial<VectorConfigDraft>) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { model: '', provider: '', adapter: 'lancedb' }), ...next } }));
  }

  async function saveCollection(key: string) {
    const row = rows.find((item) => item.key === key);
    const draft = drafts[key];
    if (!row || !draft) return;

    const payload: Record<string, string> = {};
    if (draft.model !== row.model) payload.model = draft.model.trim();
    if (draft.provider !== row.provider) payload.provider = draft.provider.trim();
    if (draft.adapter !== row.adapter) payload.adapter = draft.adapter;
    if (!Object.keys(payload).length) {
      setActionMessage((current) => ({ ...current, [key]: 'No changes to save.' }));
      return;
    }

    setSaving((current) => ({ ...current, [key]: true }));
    try {
      await fetchJson<unknown>(`/api/v1/vector/config/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(payload) });
      setActionMessage((current) => ({ ...current, [key]: 'Saved. Refreshing…' }));
      await loadConfig();
      setActionMessage((current) => ({ ...current, [key]: 'Saved.' }));
    } catch (cause) {
      setActionMessage((current) => ({ ...current, [key]: `Save failed: ${cause instanceof Error ? cause.message : String(cause)}` }));
    } finally {
      setSaving((current) => ({ ...current, [key]: false }));
    }
  }

  async function testCollection(key: string) {
    setTesting((current) => ({ ...current, [key]: true }));
    setActionMessage((current) => ({ ...current, [key]: '' }));
    try {
      const response = await fetchJson<VectorCollectionTest>(`/api/v1/vector/config/${encodeURIComponent(key)}/test`, { method: 'POST' });
      const message = response.success
        ? `Test passed · docs ${response.count ?? 0}`
        : `Test failed · ${response.error ?? response.status ?? 'unknown error'}`;
      setActionMessage((current) => ({ ...current, [key]: message }));
    } catch (cause) {
      setActionMessage((current) => ({ ...current, [key]: `Test failed: ${cause instanceof Error ? cause.message : String(cause)}` }));
    } finally {
      setTesting((current) => ({ ...current, [key]: false }));
      void loadConfig().catch(() => undefined);
    }
  }

  async function reloadVector() {
    setReloading(true);
    setReloadStatus('');
    setError('');
    try {
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      setReloadStatus(`Reloaded at ${new Date().toLocaleTimeString()}`);
      await loadConfig();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  }

  return (
    <section className="grid gap-5" aria-labelledby="vector-settings-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Vector settings</p>
            <h1 id="vector-settings-title" className="mt-2 text-3xl font-semibold text-white">Vector config and indexing</h1>
            <p className="mt-2 text-sm text-slate-400">Manage vector collection settings and run quick health checks.</p>
            <p className="mt-2 text-sm text-slate-500">{stats}</p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-purple-300/40" type="button" onClick={() => void loadConfig()}>
              {state === 'loading' ? <Spinner label="Refreshing" /> : 'Refresh config'}
            </button>
            <button
              className="focus-ring rounded-xl bg-purple-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={reloading}
              type="button"
              onClick={() => void reloadVector()}
            >
              {reloading ? <Spinner label="Reloading" /> : 'Reload runtime cache'}
            </button>
          </div>
        </div>

        {config ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Source / Version</dt><dd className="font-semibold text-teal-200">{config.source} · v{config.config.version}</dd></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Store</dt><dd className="font-semibold text-teal-200">{config.config.host}:{config.config.port}</dd></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Data path</dt><dd className="font-semibold text-teal-200 break-all">{config.config.dataPath}</dd></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Embedder</dt><dd className="font-semibold text-teal-200">{config.config.embedder?.backend ?? 'unknown'}</dd></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 sm:col-span-2"><dt className="text-slate-500">Checked</dt><dd className="font-semibold text-teal-200">{new Date(config.checked_at).toLocaleString()}</dd></div>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3 sm:col-span-2"><dt className="text-slate-500">Embedding endpoint</dt><dd className="font-semibold text-teal-200">{config.config.embeddingEndpoint || 'not configured'}</dd></div>
          </dl>
        ) : null}
        {reloadStatus ? <p className="mt-3 text-sm text-slate-300">{reloadStatus}</p> : null}
      </header>

      {state === 'loading' ? <LoadingPanel title="Loading vector config" detail="Reading /api/v1/vector/config." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load vector config." message={error} /> : null}
      {error && state !== 'error' ? <ErrorMessage title="Vector settings warning" message={error} /> : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Collections</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Collection settings</h2>
          <p className="mt-2 text-sm text-slate-400">Edit provider, model, and adapter per collection.</p>

          <div className="mt-4 grid gap-3">
            {rows.map((row) => {
              const draft = drafts[row.key] ?? { model: row.model, provider: row.provider, adapter: row.adapter };
              const dirty = draft.model !== row.model || draft.provider !== row.provider || draft.adapter !== row.adapter;
              return (
                <article key={row.key} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-teal-200">{row.collection}</h3>
                      <p className="mt-1 text-sm text-slate-400">{row.key} · {row.count ?? 0} docs · {row.primary ? 'Primary' : 'Secondary'}</p>
                    </div>
                    <CollectionStatus status={row.health} />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm text-slate-300">
                      Model
                      <input aria-label={`${row.key} model`} className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.model} onChange={(event) => updateDraft(row.key, { model: event.target.value })} />
                    </label>
                    <label className="grid gap-2 text-sm text-slate-300">
                      Provider
                      <input aria-label={`${row.key} provider`} className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.provider} onChange={(event) => updateDraft(row.key, { provider: event.target.value })} />
                    </label>
                    <label className="grid gap-2 text-sm text-slate-300">
                      Adapter
                      <select aria-label={`${row.key} adapter`} className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100" value={draft.adapter} onChange={(event) => updateDraft(row.key, { adapter: event.target.value as VectorConfigAdapter })}>
                        {ADAPTER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="focus-ring rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!dirty || Boolean(saving[row.key])}
                      type="button"
                      onClick={() => void saveCollection(row.key)}
                    >
                      {saving[row.key] ? <Spinner label="Saving" /> : 'Save'}
                    </button>
                    <button
                      className="focus-ring rounded-xl border border-purple-300/30 px-3 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={Boolean(testing[row.key])}
                      type="button"
                      onClick={() => void testCollection(row.key)}
                    >
                      {testing[row.key] ? <Spinner label="Testing" /> : 'Test'}
                    </button>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{actionMessage[row.key]}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
          <VectorIndexPanel />
        </section>
      </section>
    </section>
  );
}
