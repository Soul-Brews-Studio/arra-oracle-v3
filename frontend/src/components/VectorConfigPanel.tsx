import { useEffect, useMemo, useState } from 'react';
import { apiUrl, fetchVectorConfig, reloadVectorConfig, updateVectorCollection } from '../api';
import { ErrorMessage, Spinner } from './AsyncState';
import type { SettingsEmbedderCollection, VectorConfigResponse } from '../types';

const ADAPTERS = ['lancedb', 'qdrant', 'chroma', 'sqlite-vec', 'cloudflare-vectorize', 'proxy', 'turbovec'] as const;
export const VECTOR_PROVIDERS = ['none', 'ollama', 'gemini', 'openai', 'local', 'remote'] as const;
type SaveState = Record<string, 'idle' | 'saving' | 'testing' | 'primary'>;
type Drafts = Record<string, { adapter: string; enabled: boolean; provider: string; model: string }>;

function statusClass(status: string) {
  if (status === 'ok') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200';
  if (status === 'disabled') return 'border-slate-600 bg-slate-900/70 text-slate-400';
  return 'border-rose-400/30 bg-rose-400/10 text-rose-200';
}

function collectionEnabled(item: SettingsEmbedderCollection): boolean {
  return item.enabled !== false;
}

async function testVectorCollection(key: string): Promise<{ success?: boolean; count?: number; error?: string; status?: string }> {
  const response = await fetch(apiUrl(`/api/v1/vector/config/${encodeURIComponent(key)}/test`), { method: 'POST', headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : response.statusText);
  return payload;
}

export function VectorConfigPanel() {
  const [state, setState] = useState<VectorConfigResponse | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState<SaveState>({});

  async function load() {
    setError('');
    setLoading(true);
    try {
      const next = await fetchVectorConfig();
      setState(next);
      setDrafts(Object.fromEntries(Object.entries(next.config.collections).map(([key, item]) => [
        key,
        { adapter: item.adapter ?? 'lancedb', enabled: collectionEnabled(item), provider: item.provider, model: item.model },
      ])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => Object.entries(state?.config.collections ?? {}), [state]);
  const summary = useMemo(() => {
    const healthy = rows.filter(([key]) => state?.health[key]?.ok).length;
    const enabled = rows.filter(([, item]) => collectionEnabled(item)).length;
    return `${enabled}/${rows.length} enabled · ${healthy}/${rows.length} healthy`;
  }, [rows, state]);

  function updateDraft(key: string, patch: Partial<Drafts[string]>) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? { adapter: 'lancedb', enabled: true, provider: 'none', model: key }), ...patch } }));
  }

  async function saveAdapter(key: string) {
    const draft = drafts[key];
    if (!draft) return;
    setSaving((current) => ({ ...current, [key]: 'saving' }));
    setError('');
    setMessage('');
    try {
      await updateVectorCollection(key, { adapter: draft.adapter, enabled: draft.enabled, provider: draft.provider, model: draft.model });
      await reloadVectorConfig();
      await load();
      setMessage(`Saved ${key}: ${draft.enabled ? `${draft.adapter} · ${draft.provider} · ${draft.model}` : 'disabled'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving((current) => ({ ...current, [key]: 'idle' }));
    }
  }

  async function testAdapter(key: string) {
    setSaving((current) => ({ ...current, [key]: 'testing' }));
    setError('');
    setMessage('');
    try {
      const result = await testVectorCollection(key);
      setMessage(`${key} ${result.success ? 'ok' : result.status ?? 'failed'} · ${result.count ?? 0} docs`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving((current) => ({ ...current, [key]: 'idle' }));
    }
  }

  async function setPrimary(key: string) {
    setSaving((current) => ({ ...current, [key]: 'primary' }));
    setError('');
    setMessage('');
    try {
      await updateVectorCollection(key, { primary: true });
      await reloadVectorConfig();
      await load();
      setMessage(`Set ${key} as primary vector collection.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving((current) => ({ ...current, [key]: 'idle' }));
    }
  }

  async function reload() {
    setError('');
    setLoading(true);
    try {
      await reloadVectorConfig();
      await load();
      setMessage('Reloaded vector config cache.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Vector backend config">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">Vector config</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Active vector adapters</h3>
          <p className="mt-2 text-sm text-slate-400">Get current config, edit model/provider, switch adapters, enable rows, set primary, and test health.</p>
          <p className="mt-2 text-xs text-slate-500">{summary}</p>
        </div>
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" type="button" onClick={reload}>
          {loading ? <Spinner label="Reloading" /> : 'Reload vector config'}
        </button>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Vector config update failed." message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-2xl border border-white/10 bg-slate-900/70 p-3 text-sm text-teal-100">{message}</p> : null}

      <div className="mt-5 grid gap-3">
        {rows.map(([key, item]) => {
          const draft = drafts[key] ?? { adapter: item.adapter ?? 'lancedb', enabled: collectionEnabled(item), provider: item.provider, model: item.model };
          const health = state?.health[key];
          const status = health?.status ?? (draft.enabled ? 'unknown' : 'disabled');
          const dirty = draft.adapter !== (item.adapter ?? 'lancedb') || draft.enabled !== collectionEnabled(item) || draft.provider !== item.provider || draft.model !== item.model;
          return (
            <article key={key} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-teal-200">{key}</p>
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}>{status}</span>
                    {item.primary ? <span className="rounded-full border border-purple-300/30 px-2 py-0.5 text-xs text-purple-200">primary</span> : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-100">{item.collection}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.provider} · {item.model} · {state?.doc_counts[key] ?? 0} docs</p>
                  {health?.error ? <p className="mt-2 text-xs text-rose-300">{health.error}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Model
                    <input className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={draft.model} onChange={(event) => updateDraft(key, { model: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Active adapter
                    <select className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={draft.adapter} onChange={(event) => updateDraft(key, { adapter: event.target.value })}>
                      {ADAPTERS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Provider
                    <select className="mt-1 block rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100" value={draft.provider} onChange={(event) => updateDraft(key, { provider: event.target.value })}>
                      {VECTOR_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(key, { enabled: event.target.checked })} />
                    Enabled
                  </label>
                  <button className="focus-ring rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 disabled:opacity-50" disabled={!dirty || saving[key] === 'saving'} type="button" onClick={() => void saveAdapter(key)}>{saving[key] === 'saving' ? <Spinner label="Saving" /> : 'Save switch'}</button>
                  <button className="focus-ring rounded-xl border border-purple-300/30 px-3 py-2 text-sm font-semibold text-purple-100 disabled:opacity-50" disabled={saving[key] === 'testing'} type="button" onClick={() => void testAdapter(key)}>{saving[key] === 'testing' ? <Spinner label="Testing" /> : 'Test'}</button>
                  <button className="focus-ring rounded-xl border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50" disabled={item.primary || saving[key] === 'primary'} type="button" onClick={() => void setPrimary(key)}>{saving[key] === 'primary' ? <Spinner label="Setting primary" /> : 'Set primary'}</button>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && rows.length === 0 ? <p className="text-sm text-slate-500">No vector collections configured.</p> : null}
      </div>
    </section>
  );
}
