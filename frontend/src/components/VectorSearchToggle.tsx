import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import {
  type VectorConfigResponse,
  fetchJson,
  parseVectorConfigResponse,
  toRows,
} from '../pages/vectorSettingsHelpers';

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

export function VectorSearchToggle() {
  const [config, setConfig] = useState<VectorConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const rows = useMemo(() => config ? toRows(config) : [], [config]);
  const enabled = rows.length > 0 && rows.every((row) => row.enabled);

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
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector Search panel</p>
          <h2 id="vector-search-toggle-title" className="mt-2 text-2xl font-semibold text-white">Enable vector search</h2>
          <p className="mt-2 text-sm text-slate-400">Toggle collection indexing and hot-reload adapters through PATCH /api/v1/vector/config.</p>
          <p className="mt-2 text-xs text-slate-500">{loading ? 'Loading vector search switch…' : enabledSummary(config)}</p>
        </div>
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
      {message ? <p className="mt-4 rounded-2xl border border-teal-300/20 bg-teal-300/10 p-3 text-sm text-teal-100">{message}</p> : null}
      {error ? <div className="mt-4"><ErrorMessage title="Vector search toggle failed." message={error} /></div> : null}
    </section>
  );
}
