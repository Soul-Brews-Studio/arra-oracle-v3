import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import {
  ADAPTER_OPTIONS,
  type VectorConfigAdapter,
  type VectorConfigResponse,
  fetchJson,
  parseVectorConfigResponse,
  toRows,
} from '../pages/vectorSettingsHelpers';

const SWITCHABLE_BACKENDS = ADAPTER_OPTIONS.filter((adapter) =>
  ['lancedb', 'qdrant', 'chroma', 'sqlite-vec'].includes(adapter),
);

function enabledSummary(config: VectorConfigResponse | null): string {
  const rows = config ? toRows(config) : [];
  if (!rows.length) return 'No vector collections configured.';
  const enabled = rows.filter((row) => row.enabled).length;
  return `${enabled}/${rows.length} collections enabled for vector search.`;
}

function patchCollections(config: VectorConfigResponse, enabled: boolean) {
  return Object.fromEntries(
    Object.entries(config.config.collections).map(([key, collection]) => [
      key,
      { ...collection, enabled },
    ]),
  );
}

function patchBackend(config: VectorConfigResponse, adapter: VectorConfigAdapter) {
  return Object.fromEntries(
    Object.entries(config.config.collections).map(([key, collection]) => [
      key,
      { ...collection, adapter },
    ]),
  );
}

export function VectorSearchToggle() {
  const [config, setConfig] = useState<VectorConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const rows = useMemo(() => config ? toRows(config) : [], [config]);
  const enabled = rows.length > 0 && rows.every((row) => row.enabled);
  const backend = SWITCHABLE_BACKENDS.includes(config?.engine ?? 'lancedb') ? config?.engine ?? 'lancedb' : 'lancedb';

  async function load() {
    setError('');
    setLoading(true);
    try {
      setConfig(parseVectorConfigResponse(await fetchJson('/api/v1/vector/config')));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function switchBackend(nextAdapter: VectorConfigAdapter) {
    if (!config) return;
    setSwitching(true);
    setError('');
    setMessage('');
    try {
      await fetchJson('/api/v1/vector/config', {
        method: 'PATCH',
        body: JSON.stringify({ collections: patchBackend(config, nextAdapter) }),
      });
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      await load();
      setMessage(`Switched configured vector collections to ${nextAdapter}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitching(false);
    }
  }

  async function toggle(nextEnabled: boolean) {
    if (!config) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await fetchJson('/api/v1/vector/config', {
        method: 'PATCH',
        body: JSON.stringify({ collections: patchCollections(config, nextEnabled) }),
      });
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      await load();
      setMessage(`Vector search ${nextEnabled ? 'enabled' : 'disabled'} across configured collections.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-search-toggle-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-accent,#0f766e)]">Vector Search panel</p>
          <h2 id="vector-search-toggle-title" className="mt-2 text-2xl font-semibold text-white">Enable vector search</h2>
          <p className="mt-2 text-sm text-slate-400">Toggle collection indexing, switch all collection backends, and hot-reload adapters through PATCH /api/v1/vector/config.</p>
          <p className="mt-2 text-xs text-slate-500">{loading ? 'Loading vector search switch…' : enabledSummary(config)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Backend adapter
            <select
              className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              disabled={loading || switching || !config || rows.length === 0}
              value={backend}
              onChange={(event) => void switchBackend(event.target.value as VectorConfigAdapter)}
            >
              {SWITCHABLE_BACKENDS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-100">
            <input
              checked={enabled}
              disabled={loading || saving || !config || rows.length === 0}
              type="checkbox"
              onChange={(event) => void toggle(event.target.checked)}
            />
            {saving ? <Spinner label="Saving" /> : enabled ? 'Enabled' : 'Disabled'}
          </label>
        </div>
      </div>
      {message ? <p className="mt-4 rounded-2xl border border-[color:var(--color-accent,#0f766e)] p-3 text-sm text-[color:var(--color-accent,#0f766e)]">{message}</p> : null}
      {error ? <div className="mt-4"><ErrorMessage title="Vector search toggle failed." message={error} /></div> : null}
    </section>
  );
}
