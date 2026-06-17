import { useEffect, useMemo, useState } from 'react';
import { apiFetch, fetchVectorConfig, reloadVectorConfig, updateVectorCollection } from '../api';
import { ErrorMessage, Spinner } from './AsyncState';
import { VectorConfigHealthSummary } from './VectorConfigHealthSummary';
import type { SettingsEmbedderCollection, VectorConfigResponse } from '../types';

const ADAPTERS = ['lancedb', 'qdrant', 'chroma', 'sqlite-vec', 'cloudflare-vectorize', 'proxy', 'turbovec'] as const;
export const VECTOR_PROVIDERS = ['none', 'ollama', 'gemini', 'openai', 'local', 'remote'] as const;
type SaveState = Record<string, 'idle' | 'saving' | 'testing' | 'primary'>;
type Drafts = Record<string, { adapter: string; enabled: boolean; provider: string; model: string; service: string; endpoint: string }>;
type RuntimeState = { enabled?: boolean; ready?: boolean; primary?: string; reason?: string; recommendedAction?: string | null };
type PanelResponse = VectorConfigResponse & { enabled?: boolean; engine?: string; state?: RuntimeState };

function statusClass(status: string) {
  if (status === 'ok') return 'border-ok-border bg-ok-bg text-ok-text';
  if (status === 'disabled') return 'border-border bg-slate-900/70 text-text-muted';
  return 'border-err-border bg-err-bg text-err-text';
}

function collectionEnabled(item: SettingsEmbedderCollection): boolean {
  return item.enabled !== false;
}

function draftFrom(key: string, item?: SettingsEmbedderCollection): Drafts[string] {
  return {
    adapter: item?.adapter ?? 'lancedb',
    enabled: item ? collectionEnabled(item) : true,
    provider: item?.provider ?? 'none',
    model: item?.model ?? key,
    service: item?.service ?? '',
    endpoint: item?.endpoint ?? '',
  };
}

async function testVectorCollection(key: string): Promise<{ success?: boolean; count?: number; error?: string; status?: string }> {
  const response = await apiFetch(`/api/v1/vector/config/${encodeURIComponent(key)}/test`, { method: 'POST', headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : response.statusText);
  return payload;
}

export function VectorConfigPanel() {
  const [state, setState] = useState<PanelResponse | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState<SaveState>({});

  async function load() {
    setError('');
    setLoading(true);
    try {
      const next = await fetchVectorConfig() as PanelResponse;
      setState(next);
      setDrafts(Object.fromEntries(Object.entries(next.config.collections).map(([key, item]) => [
        key,
        draftFrom(key, item),
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
  const runtime = state?.state;

  function updateDraft(key: string, patch: Partial<Drafts[string]>) {
    setDrafts((current) => ({ ...current, [key]: { ...(current[key] ?? draftFrom(key)), ...patch } }));
  }

  async function saveAdapter(key: string) {
    const draft = drafts[key];
    if (!draft) return;
    setSaving((current) => ({ ...current, [key]: 'saving' }));
    setError('');
    setMessage('');
    try {
      await updateVectorCollection(key, {
        adapter: draft.adapter, enabled: draft.enabled, provider: draft.provider, model: draft.model,
        service: draft.service, endpoint: draft.endpoint,
      });
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
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-label="Vector backend config">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Vector config</p>
          <h3 className="mt-2 text-lg font-semibold text-text">Active vector adapters</h3>
          <p className="mt-2 text-sm text-text-muted">Get current config, edit model/provider plus service endpoint, switch adapters, enable rows, set primary, and test health.</p>
          <p className="mt-2 text-xs text-text-muted">{summary}</p>
          <p className="mt-2 text-xs text-text-muted">
            Source {state?.source ?? 'loading'} · engine {state?.engine ?? 'loading'} · primary {runtime?.primary ?? 'none'} · {runtime?.ready ? 'ready' : 'not ready'}
          </p>
          {runtime?.reason ? <p className="mt-1 text-xs text-warn-text">State: {runtime.reason}{runtime.recommendedAction ? ` · ${runtime.recommendedAction}` : ''}</p> : null}
        </div>
        <button className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-teal-300/40" type="button" onClick={reload}>
          {loading ? <Spinner label="Reloading" /> : 'Reload vector config'}
        </button>
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Vector config update failed." message={error} /></div> : null}
      {message ? <p className="mt-4 rounded-2xl border border-border bg-slate-900/70 p-3 text-sm text-accent">{message}</p> : null}
      {state ? <VectorConfigHealthSummary collections={state.config.collections} health={state.health} /> : null}

      <div className="mt-5 grid gap-3">
        {rows.map(([key, item]) => {
          const draft = drafts[key] ?? draftFrom(key, item);
          const health = state?.health[key];
          const status = health?.status ?? (draft.enabled ? 'unknown' : 'disabled');
          const dirty = draft.adapter !== (item.adapter ?? 'lancedb') || draft.enabled !== collectionEnabled(item)
            || draft.provider !== item.provider || draft.model !== item.model
            || draft.service !== (item.service ?? '') || draft.endpoint !== (item.endpoint ?? '');
          return (
            <article key={key} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm text-accent">{key}</p>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${statusClass(status)}`}><span aria-hidden="true">●</span>{status}</span>
                    {item.primary ? <span className="rounded-full border border-accent2-border px-2 py-0.5 text-xs text-accent2">primary</span> : null}
                  </div>
                  <p className="mt-2 text-sm text-text">{item.collection}</p>
                  <p className="mt-1 text-xs text-text-muted">{item.provider} · {item.model} · {state?.doc_counts[key] ?? 0} docs</p>
                  {item.service || item.endpoint ? <p className="mt-1 text-xs text-text-muted">Service {item.service || 'default'} · {item.endpoint || 'no endpoint'}</p> : null}
                  {health?.error ? <p className="mt-2 text-xs text-err-text">{health.error}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Model
                    <input className="mt-1 block rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" value={draft.model} onChange={(event) => updateDraft(key, { model: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Active adapter
                    <select className="mt-1 block rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" value={draft.adapter} onChange={(event) => updateDraft(key, { adapter: event.target.value })}>
                      {ADAPTERS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Provider
                    <select className="mt-1 block rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" value={draft.provider} onChange={(event) => updateDraft(key, { provider: event.target.value })}>
                      {VECTOR_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Service
                    <input className="mt-1 block rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" placeholder="registry key" value={draft.service} onChange={(event) => updateDraft(key, { service: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Endpoint
                    <input className="mt-1 block rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" placeholder="http://localhost:6333" value={draft.endpoint} onChange={(event) => updateDraft(key, { endpoint: event.target.value })} />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(key, { enabled: event.target.checked })} />
                    Enabled
                  </label>
                  <button className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50" disabled={!dirty || saving[key] === 'saving'} type="button" onClick={() => void saveAdapter(key)}>{saving[key] === 'saving' ? <Spinner label="Saving" /> : 'Save switch'}</button>
                  <button className="focus-ring rounded-xl border border-accent2-border px-3 py-2 text-sm font-semibold text-accent2 disabled:opacity-50" disabled={saving[key] === 'testing'} type="button" onClick={() => void testAdapter(key)}>{saving[key] === 'testing' ? <Spinner label="Testing" /> : 'Test'}</button>
                  <button className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50" disabled={item.primary || saving[key] === 'primary'} type="button" onClick={() => void setPrimary(key)}>{saving[key] === 'primary' ? <Spinner label="Setting primary" /> : 'Set primary'}</button>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && rows.length === 0 ? <p className="text-sm text-text-muted">No vector collections configured.</p> : null}
      </div>
    </section>
  );
}
