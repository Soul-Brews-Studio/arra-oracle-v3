import { useEffect, useMemo, useState } from 'react';
import { VectorAdapterSwitcher } from '../components/VectorAdapterSwitcher';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { FirstRunWizard } from './FirstRunWizard';
import { IndexManagerPanel } from './IndexManagerPanel';
import { VectorCollectionList } from './VectorCollectionList';
import { type LoadState, type VectorCollectionTest, type VectorConfigDraft, type VectorConfigResponse, type VectorConfigRow, fetchJson, parseVectorConfigResponse, toRows } from './vectorSettingsHelpers';

export function VectorSettingsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [config, setConfig] = useState<VectorConfigResponse | null>(null);
  const [rows, setRows] = useState<VectorConfigRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VectorConfigDraft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [primarySaving, setPrimarySaving] = useState('');
  const [actionMessage, setActionMessage] = useState<Record<string, string>>({});
  const [reloading, setReloading] = useState(false);
  const [reloadStatus, setReloadStatus] = useState('');

  async function loadConfig() {
    setState('loading');
    setError('');
    try {
      const normalized = parseVectorConfigResponse(await fetchJson<VectorConfigResponse>('/api/v1/vector/config'));
      const nextRows = toRows(normalized);
      setConfig(normalized);
      setRows(nextRows);
      setDrafts(Object.fromEntries(nextRows.map((row) => [row.key, { model: row.model, provider: row.provider, adapter: row.adapter }])));
      setState('ready');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setState('error');
    }
  }

  useEffect(() => { void loadConfig(); }, []);

  const stats = useMemo(() => {
    if (!rows.length || !config) return 'No vector collections loaded.';
    const healthy = rows.filter((item) => item.health?.ok).length;
    const primary = rows.find((item) => item.primary)?.key ?? 'none';
    return `${rows.length} collections · ${healthy}/${rows.length} healthy · primary ${primary} · source ${config.source}`;
  }, [rows, config]);

  function updateDraft(key: string, next: Partial<VectorConfigDraft>) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { model: '', provider: '', adapter: 'lancedb' }), ...next } }));
  }

  async function saveCollection(key: string) {
    const row = rows.find((item) => item.key === key);
    const draft = drafts[key];
    if (!row || !draft) return;
    const payload = Object.fromEntries(Object.entries({ model: draft.model.trim(), provider: draft.provider.trim(), adapter: draft.adapter }).filter(([name, value]) => value !== row[name as keyof VectorConfigRow]));
    if (!Object.keys(payload).length) return setActionMessage((current) => ({ ...current, [key]: 'No changes to save.' }));
    setSaving((current) => ({ ...current, [key]: true }));
    try {
      await fetchJson(`/api/v1/vector/config/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(payload) });
      await loadConfig();
      setActionMessage((current) => ({ ...current, [key]: 'Saved.' }));
    } catch (cause) {
      setActionMessage((current) => ({ ...current, [key]: `Save failed: ${cause instanceof Error ? cause.message : String(cause)}` }));
    } finally { setSaving((current) => ({ ...current, [key]: false })); }
  }

  async function testCollection(key: string) {
    setTesting((current) => ({ ...current, [key]: true }));
    try {
      const response = await fetchJson<VectorCollectionTest>(`/api/v1/vector/config/${encodeURIComponent(key)}/test`, { method: 'POST' });
      setActionMessage((current) => ({ ...current, [key]: response.success ? `Test passed · docs ${response.count ?? 0}` : `Test failed · ${response.error ?? response.status ?? 'unknown error'}` }));
    } catch (cause) {
      setActionMessage((current) => ({ ...current, [key]: `Test failed: ${cause instanceof Error ? cause.message : String(cause)}` }));
    } finally { setTesting((current) => ({ ...current, [key]: false })); void loadConfig(); }
  }

  async function setPrimary(key: string) {
    setPrimarySaving(key);
    try {
      await fetchJson(`/api/v1/vector/config/${encodeURIComponent(key)}/primary`, { method: 'POST' });
      await loadConfig();
      setActionMessage((current) => ({ ...current, [key]: 'Primary collection updated.' }));
    } catch (cause) {
      setActionMessage((current) => ({ ...current, [key]: `Primary failed: ${cause instanceof Error ? cause.message : String(cause)}` }));
    } finally { setPrimarySaving(''); }
  }

  async function reloadVector() {
    setReloading(true);
    try {
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      setReloadStatus(`Reloaded at ${new Date().toLocaleTimeString()}`);
      await loadConfig();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setReloading(false); }
  }

  return (
    <section className="grid gap-5" aria-labelledby="vector-settings-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Vector settings</p><h1 id="vector-settings-title" className="mt-2 text-3xl font-semibold text-white">Vector config and indexing</h1><p className="mt-2 text-sm text-slate-400">Manage vector collection settings, first-run setup, and index jobs.</p><p className="mt-2 text-sm text-slate-500">{stats}</p></div><div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end"><button className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200" type="button" onClick={() => void loadConfig()}>{state === 'loading' ? <Spinner label="Refreshing" /> : 'Refresh config'}</button><button className="focus-ring rounded-xl bg-purple-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60" disabled={reloading} type="button" onClick={() => void reloadVector()}>{reloading ? <Spinner label="Reloading" /> : 'Reload runtime cache'}</button></div></div>
        {config ? <ConfigSummary config={config} /> : null}
        {reloadStatus ? <p className="mt-3 text-sm text-slate-300">{reloadStatus}</p> : null}
      </header>
      {state === 'loading' ? <LoadingPanel title="Loading vector config" detail="Reading /api/v1/vector/config." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load vector config." message={error} /> : null}
      {error && state !== 'error' ? <ErrorMessage title="Vector settings warning" message={error} /> : null}
      {state === 'ready' ? <VectorAdapterSwitcher rows={rows} onRefresh={loadConfig} /> : null}
      {state === 'ready' ? <FirstRunWizard rows={rows} onRefresh={loadConfig} /> : null}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <VectorCollectionList rows={rows} drafts={drafts} saving={saving} testing={testing} primarySaving={primarySaving} actionMessage={actionMessage} onDraft={updateDraft} onSave={(key) => void saveCollection(key)} onTest={(key) => void testCollection(key)} onPrimary={(key) => void setPrimary(key)} />
        <IndexManagerPanel />
      </section>
    </section>
  );
}

function ConfigSummary({ config }: { config: VectorConfigResponse }) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Source / Version</dt><dd className="font-semibold text-teal-200">{config.source} · v{config.config.version}</dd></div><div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Store</dt><dd className="font-semibold text-teal-200">{config.config.host}:{config.config.port}</dd></div><div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Data path</dt><dd className="break-all font-semibold text-teal-200">{config.config.dataPath}</dd></div><div className="rounded-xl border border-white/10 bg-slate-950/70 p-3"><dt className="text-slate-500">Embedder</dt><dd className="font-semibold text-teal-200">{config.config.embedder?.backend ?? 'unknown'}</dd></div></dl>;
}
