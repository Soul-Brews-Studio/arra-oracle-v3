import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../AsyncState';
import { apiUrl, type VectorProvider } from '../../api/oracle';
import { useFirstRun } from '../../hooks/useFirstRun';

type Step = 0 | 1 | 2 | 3;
type LoadState = 'loading' | 'ready' | 'error';

type CollectionPlan = {
  key: string;
  label: string;
  collection: string;
  model: string;
  selected: boolean;
  primary?: boolean;
};

const steps = ['Welcome', 'Provider', 'Collections', 'Confirm'] as const;
const defaultPlans: CollectionPlan[] = [
  { key: 'bge-m3', label: 'BGE M3', collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', selected: true, primary: true },
  { key: 'nomic', label: 'Nomic Embed Text', collection: 'oracle_knowledge', model: 'nomic-embed-text', selected: true },
  { key: 'qwen3', label: 'Qwen3 Embedding', collection: 'oracle_knowledge_qwen3', model: 'qwen3-embedding', selected: false },
];

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : response.statusText;
    throw new Error(`${path} returned ${response.status}: ${error}`);
  }
  return payload as T;
}

function providerLabel(provider?: VectorProvider): string {
  if (!provider) return 'No provider selected';
  const state = provider.available ? 'available' : provider.configured ? 'configured' : provider.status ?? 'unavailable';
  return `${provider.type} · ${state}`;
}

function providerModels(provider?: VectorProvider): string {
  return provider?.models?.slice(0, 3).join(', ') || provider?.error || provider?.status || 'No models reported';
}

function copyFor(step: Step): string {
  if (step === 0) return 'Oracle turns local notes, docs, traces, and handoffs into searchable memory for the operator dashboard and MCP tools.';
  if (step === 1) return 'Choose the embedding provider that will generate vectors for semantic search.';
  if (step === 2) return 'Pick the initial vector collections to create before the first index run.';
  return 'Review the setup choices, create selected collections, and start initial indexing.';
}

export function FirstRunWizard() {
  const { markSetupComplete, setupComplete } = useFirstRun();
  const [step, setStep] = useState<Step>(0);
  const [providers, setProviders] = useState<VectorProvider[]>([]);
  const [providerType, setProviderType] = useState('');
  const [plans, setPlans] = useState(defaultPlans);
  const [state, setState] = useState<LoadState>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    json<{ providers?: VectorProvider[] }>('/api/v1/vector/providers')
      .then((body) => {
        if (!active) return;
        const next = body.providers ?? [];
        setProviders(next);
        setProviderType((current) => current || next.find((item) => item.available || item.configured)?.type || next[0]?.type || 'none');
        setState('ready');
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setState('error');
      });
    return () => { active = false; };
  }, []);

  const selected = useMemo(() => plans.filter((plan) => plan.selected), [plans]);
  const selectedProvider = providers.find((provider) => provider.type === providerType);

  function toggleCollection(key: string) {
    setPlans((current) => current.map((plan) => (
      plan.key === key ? { ...plan, selected: !plan.selected } : plan
    )));
    setMessage('');
  }

  async function startInitialIndexing() {
    if (!selected.length) return setError('Select at least one collection before starting indexing.');
    setBusy(true);
    setError('');
    setMessage('');
    try {
      for (const plan of selected) {
        await json(`/api/v1/vector/config/${encodeURIComponent(plan.key)}`, {
          method: 'POST',
          body: JSON.stringify({
            collection: plan.collection,
            model: plan.model,
            provider: providerType,
            adapter: 'lancedb',
            primary: plan.primary === true,
          }),
        }).catch((cause) => {
          if (cause instanceof Error && cause.message.includes('409')) return null;
          throw cause;
        });
        await json('/api/v1/vector/index/start', { method: 'POST', body: JSON.stringify({ model: plan.key }) });
      }
      markSetupComplete();
      setMessage(`Started indexing ${selected.length} collection${selected.length === 1 ? '' : 's'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-5" aria-labelledby="first-run-wizard-title">
      <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">First-run setup</p>
        <h1 id="first-run-wizard-title" className="mt-2 text-3xl font-semibold text-white">{steps[step]}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{copyFor(step)}</p>
        <ol className="mt-5 grid gap-2 sm:grid-cols-4" aria-label="First-run steps">
          {steps.map((label, index) => (
            <li key={label} className={`h-2 rounded-full ${index <= step ? 'bg-teal-300' : 'bg-white/15'}`} />
          ))}
        </ol>
      </div>

      {state === 'loading' ? <LoadingPanel title="Loading providers" detail="Fetching /api/v1/vector/providers." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load embedding providers." message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <WelcomeCard active={step === 0} complete={setupComplete} />
        <ProviderCard active={step === 1} providers={providers} providerType={providerType} onChange={setProviderType} />
        <CollectionsCard active={step === 2} plans={plans} onToggle={toggleCollection} />
        <ConfirmCard active={step === 3} provider={selectedProvider} providerType={providerType} selected={selected} busy={busy} onStart={() => void startInitialIndexing()} />
      </div>

      {message ? <p className="rounded-2xl border border-[color:var(--color-accent,#0f766e)] p-4 text-sm text-[color:var(--color-accent,#0f766e)]">{message}</p> : null}
      {error && state !== 'error' ? <ErrorMessage title="First-run setup failed." message={error} /> : null}

      <div className="flex flex-wrap gap-3">
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:opacity-50" disabled={step === 0} type="button" onClick={() => setStep((step - 1) as Step)}>Back</button>
        <button className="focus-ring rounded-xl bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50" disabled={step === 3} type="button" onClick={() => setStep((step + 1) as Step)}>Next</button>
      </div>
    </section>
  );
}

function cardClass(active: boolean): string {
  return `rounded-3xl border p-5 sm:p-6 ${active ? 'border-teal-300/40 bg-teal-300/10' : 'border-white/10 bg-white/[0.03]'}`;
}

function WelcomeCard({ active, complete }: { active: boolean; complete: boolean }) {
  return (
    <article className={`${cardClass(active)} lg:col-span-2`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Welcome</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Oracle memory layer</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">Oracle indexes operational knowledge, embeds it into vector collections, and exposes fast search through the dashboard and MCP tools.</p>
      <p className="mt-4 text-sm text-slate-400">{complete ? 'Setup was already marked complete on this device.' : 'Setup has not been completed on this device.'}</p>
    </article>
  );
}

function ProviderCard({ active, providers, providerType, onChange }: { active: boolean; providers: VectorProvider[]; providerType: string; onChange: (value: string) => void }) {
  return (
    <article className={`${cardClass(active)} lg:col-span-2`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Provider</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Embedding provider</h2>
      <select className="focus-ring mt-5 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100" value={providerType} onChange={(event) => onChange(event.target.value)}>
        {providers.length ? providers.map((provider) => <option key={provider.type} value={provider.type}>{providerLabel(provider)}</option>) : <option value="none">No providers loaded</option>}
      </select>
      <p className="mt-3 text-sm text-slate-400">{providerModels(providers.find((provider) => provider.type === providerType))}</p>
    </article>
  );
}

function CollectionsCard({ active, plans, onToggle }: { active: boolean; plans: CollectionPlan[]; onToggle: (key: string) => void }) {
  return (
    <article className={`${cardClass(active)} lg:col-span-2`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Collections</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Collections to create</h2>
      <div className="mt-5 grid gap-3">
        {plans.map((plan) => (
          <label key={plan.key} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
            <span><span className="font-semibold">{plan.label}</span><span className="block text-xs text-slate-500">{plan.collection}</span></span>
            <input className="h-5 w-5 accent-teal-300" checked={plan.selected} type="checkbox" onChange={() => onToggle(plan.key)} />
          </label>
        ))}
      </div>
    </article>
  );
}

function ConfirmCard({ active, provider, providerType, selected, busy, onStart }: { active: boolean; provider?: VectorProvider; providerType: string; selected: CollectionPlan[]; busy: boolean; onStart: () => void }) {
  return (
    <article className={`${cardClass(active)} lg:col-span-2`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Confirm</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Start initial indexing</h2>
      <dl className="mt-4 grid gap-2 text-sm text-slate-300">
        <div><dt className="text-slate-500">Provider</dt><dd className="font-medium text-white">{providerLabel(provider) || providerType}</dd></div>
        <div><dt className="text-slate-500">Collections</dt><dd className="font-medium text-white">{selected.map((plan) => plan.key).join(', ') || 'none selected'}</dd></div>
      </dl>
      <button className="focus-ring mt-5 rounded-xl bg-teal-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || !selected.length} type="button" onClick={onStart}>
        {busy ? <Spinner label="Starting index" /> : 'Create collections and index'}
      </button>
    </article>
  );
}
