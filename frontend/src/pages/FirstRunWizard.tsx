import { useCallback, useEffect, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { fetchJson, parseVectorConfigResponse, toRows, type VectorConfigRow } from './vectorSettingsHelpers';
import { DEFAULT_VECTOR_COLLECTION, detectDefaultVectorBackend } from '../../../src/config/defaults';

type WizardStep = 0 | 1 | 2 | 3;
type StatsResponse = { total?: number; total_docs?: number; vector?: { enabled?: boolean; count?: number } };
type CostEstimate = {
  docs: number;
  tokensPerDoc: number;
  totalTokens: number;
  provider: string;
  model: string;
  estimatedUsd: number;
  formula: string;
  note: string;
  recommendation: string;
  fallbackSummary?: string;
};

export type FirstRunWizardProps = {
  rows: VectorConfigRow[];
  onRefresh: () => Promise<void> | void;
  initialStep?: WizardStep;
  initialCost?: CostEstimate | null;
};

const steps = ['Welcome', 'Backend', 'Vault + index', 'Done'] as const;
type WizardResolution = ReturnType<typeof detectFirstRunWizardResolution>;

export function VectorFirstRunWizardPage() {
  const [rows, setRows] = useState<VectorConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const body = await fetchJson<unknown>('/api/v1/vector/config');
      setRows(toRows(parseVectorConfigResponse(body)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="grid gap-5" aria-labelledby="vector-first-run-title">
      <header className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Vector onboarding</p>
        <h1 id="vector-first-run-title" className="mt-2 text-3xl font-semibold text-text">First-run setup wizard</h1>
        <p className="mt-2 text-sm text-text-muted">Arra selects sqlite-vec automatically. This page is optional/advanced for review, cost, and first index controls.</p>
      </header>

      <FirstRunWizard rows={rows} onRefresh={refresh} />
      {loading ? <LoadingPanel title="Loading first-run vector config…" detail="Fetching /api/v1/vector/config." /> : null}
      {error ? <ErrorMessage title="Could not load first-run vector config." message={error} /> : null}
    </section>
  );
}

function primaryRow(rows: VectorConfigRow[]): VectorConfigRow | null {
  return rows.find((row) => row.primary) ?? rows[0] ?? null;
}

function indexedCount(stats: StatsResponse | null, rows: VectorConfigRow[]): number {
  return stats?.vector?.count ?? rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
}

export function detectFirstRunWizardResolution(rows: VectorConfigRow[], stats: StatsResponse | null) {
  const primary = primaryRow(rows);
  const count = indexedCount(stats, rows);
  const choice = detectDefaultVectorBackend({
    configuredEngine: primary?.adapter,
    hasExistingIndex: count > 0 || stats?.vector?.enabled === true,
  });
  return {
    ...choice,
    count,
    key: primary?.key ?? DEFAULT_VECTOR_COLLECTION.key,
    collection: primary?.collection ?? DEFAULT_VECTOR_COLLECTION.collection,
  };
}

export function FirstRunWizard({ rows, onRefresh, initialStep = 0, initialCost = null }: FirstRunWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [cost, setCost] = useState<CostEstimate | null>(initialCost);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const resolution = detectFirstRunWizardResolution(rows, stats);
  const showAsFirstRun = !resolution.returningUser && resolution.count === 0;

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchJson<StatsResponse>('/api/v1/stats'),
      fetchJson<CostEstimate>('/api/v1/vector/cost-estimate'),
    ]).then(([statsResult, costResult]) => {
      if (!active) return;
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
      if (costResult.status === 'fulfilled') setCost(costResult.value);
    });
    return () => { active = false; };
  }, []);

  async function reloadHealth() {
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/v1/vector/config/reload', { method: 'POST' });
      await onRefresh();
      setMessage('Local backend refreshed. Review collection health and continue.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startIndex() {
    const model = resolution.key;
    setBusy(true);
    setError('');
    try {
      await fetchJson('/api/v1/vector/index/start', { method: 'POST', body: JSON.stringify({ model }) });
      setStep(3);
      setMessage(`Started indexing ${model}. Track progress in the Index Manager.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`glass rounded-3xl border bg-[oklch(0.16_0.02_265/0.35)] p-5 shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl sm:p-6 ${showAsFirstRun ? 'border-purple-300/20' : 'border-[oklch(1_0_0/0.08)]'}`} aria-labelledby="first-run-wizard-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Optional first-run wizard</p>
          <h2 id="first-run-wizard-title" className="mt-2 text-2xl font-semibold text-text">{steps[step]}</h2>
          <p className="mt-2 max-w-3xl text-sm text-purple-100/80">{copyFor(step, resolution, showAsFirstRun)}</p>
        </div>
        <ol className="flex gap-2" aria-label="First-run steps">{steps.map((item, index) => <li key={item} className={`h-2 w-10 rounded-full ${index <= step ? 'bg-purple-200' : 'bg-white/20'}`} />)}</ol>
      </div>

      {step === 1 ? <BackendPlan resolution={resolution} /> : null}
      {step === 2 ? <VaultPlan resolution={resolution} cost={cost} /> : null}
      {step === 3 ? <DoneActions /> : null}
      {message ? <p className="mt-4 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] p-3 text-sm text-purple-100 backdrop-blur-md">{message}</p> : null}
      {error ? <div className="mt-4"><ErrorMessage title="First-run step failed." message={error} /></div> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="focus-ring rounded-xl border border-border px-3 py-2 text-sm text-purple-100 disabled:opacity-50" disabled={step === 0} type="button" onClick={() => setStep((step - 1) as WizardStep)}>Back</button>
        {step === 0 ? <button className="focus-ring rounded-xl bg-purple-200 px-3 py-2 text-sm font-semibold text-on-accent" type="button" onClick={() => void reloadHealth()}>{busy ? <Spinner label="Detecting" /> : 'Detect local defaults'}</button> : null}
        {step === 2 ? <button className="focus-ring rounded-xl bg-teal-200 px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-50" disabled={busy} type="button" onClick={() => void startIndex()}>{busy ? <Spinner label="Starting" /> : 'Start indexing'}</button> : null}
        <button className="focus-ring rounded-xl border border-purple-200/40 px-3 py-2 text-sm font-semibold text-purple-100 disabled:opacity-50" disabled={step === 3} type="button" onClick={() => setStep((step + 1) as WizardStep)}>Next</button>
        {step === 3 ? <a className="focus-ring rounded-xl bg-teal-200 px-3 py-2 text-sm font-semibold text-on-accent" href="/vector">Continue to dashboard</a> : null}
      </div>
    </section>
  );
}

function copyFor(step: WizardStep, resolution: WizardResolution, firstRun: boolean): string {
  if (step === 0) return firstRun ? `No provider prompt: ${resolution.engine} is selected automatically; build the first index when ready.` : `Existing backend detected (${resolution.engine}); this wizard is optional/advanced.`;
  if (step === 1) return `detect() resolved ${resolution.engine} from ${resolution.source}; returning users keep saved backend choices.`;
  if (step === 2) return `Review ${resolution.collection}, estimated cost, and recommendation before indexing.`;
  return 'Indexing has started. The Index Manager shows live progress and completion state.';
}


function DoneActions() {
  return (
    <div className="mt-4 rounded-2xl border border-accent-border p-4 text-sm text-accent">
      <p className="font-semibold text-accent">Vector setup is underway</p>
      <p className="mt-1">Continue to the Vector dashboard for collection health, or open the Index Manager for live progress.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="focus-ring rounded-xl bg-teal-200 px-3 py-2 text-sm font-semibold text-on-accent" href="/vector">Open Vector dashboard</a>
        <a className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent" href="/vector/index">Open Index Manager</a>
      </div>
    </div>
  );
}

function BackendPlan({ resolution }: { resolution: WizardResolution }) {
  return (
    <div className="mt-4 rounded-2xl border border-accent-border p-4 text-sm text-accent">
      <p className="font-semibold">Local backend default is active</p>
      <p className="mt-1">No provider prompt or provider choice is required before indexing. Returning users keep their saved adapter automatically.</p>
      <p className="mt-2 text-accent opacity-80">Primary adapter: {resolution.engine} · collection {resolution.collection}</p>
    </div>
  );
}

function VaultPlan({ resolution, cost }: { resolution: WizardResolution; cost: CostEstimate | null }) {
  return (
    <div className="mt-4 grid gap-3 text-sm text-purple-100 lg:grid-cols-[1fr_1.3fr]">
      <div className="rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] p-4 backdrop-blur-md">
        <p>Primary collection: <span className="font-semibold">{resolution.collection}</span></p>
        <p className="mt-1 text-purple-100/70">Vault selection is represented by indexed source documents; use Index now to backfill vectors for the primary model.</p>
      </div>
      <div className="rounded-2xl border border-accent-border p-4">
        <p className="font-semibold text-accent">Estimated embedding cost</p>
        {cost ? <CostSummary cost={cost} /> : <p className="mt-2 text-accent opacity-70">Cost estimate will appear after backend detection completes.</p>}
      </div>
    </div>
  );
}

function CostSummary({ cost }: { cost: CostEstimate }) {
  return (
    <div className="mt-2 space-y-2 text-accent opacity-85">
      <p>{cost.docs.toLocaleString()} docs · {cost.tokensPerDoc.toLocaleString()} tokens/doc · {cost.totalTokens.toLocaleString()} tokens total</p>
      <p>{cost.provider} / {cost.model}: <span className="font-semibold text-accent">${cost.estimatedUsd.toFixed(4)}</span></p>
      <p className="text-accent opacity-70">{cost.formula}</p>
      {cost.fallbackSummary ? <p className="text-accent opacity-70">{cost.fallbackSummary}</p> : null}
      <p><span className="font-semibold text-accent">Recommendation:</span> {cost.recommendation}</p>
      <p className="text-accent opacity-70">{cost.note}</p>
    </div>
  );
}
