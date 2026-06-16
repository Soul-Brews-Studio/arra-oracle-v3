import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import { fetchJson } from '../pages/vectorSettingsHelpers';

type ProviderCost = {
  provider?: string;
  model?: string;
  estimatedUsd?: number;
  note?: string;
};

type CostEstimate = ProviderCost & {
  docs: number;
  tokensPerDoc: number;
  totalTokens: number;
  provider: string;
  model: string;
  estimatedUsd: number;
  formula: string;
  note: string;
  recommendation: string;
  availableProviders?: string[];
  providerEstimates?: Record<string, ProviderCost>;
  trackingEndpoint?: string;
};

type Props = {
  defaultProvider?: string;
  initialEstimate?: CostEstimate | null;
};

function formatUsd(value?: number): string {
  if (typeof value !== 'number') return 'unknown';
  return value === 0 ? 'Free / local' : `$${value.toFixed(4)}`;
}

function providerSummary(providers?: string[]): string {
  return providers?.length ? `${providers.join(', ')} available` : 'Provider availability pending auto-detect';
}

export function VectorModelRecommendationCard({ defaultProvider = 'openai', initialEstimate }: Props) {
  const [estimate, setEstimate] = useState<CostEstimate | null>(initialEstimate ?? null);
  const [loading, setLoading] = useState(initialEstimate === undefined);
  const [error, setError] = useState('');
  const estimates = useMemo<Array<[string, ProviderCost]>>(() => Object.entries(estimate?.providerEstimates ?? {}), [estimate]);
  const comparisonRows = useMemo<Array<[string, ProviderCost]>>(() => {
    if (estimates.length) return estimates;
    return estimate ? [[estimate.provider, estimate]] : [];
  }, [estimate, estimates]);

  useEffect(() => {
    if (initialEstimate !== undefined) return;
    let active = true;
    setLoading(true);
    fetchJson<CostEstimate>(`/api/v1/vector/cost-estimate?provider=${encodeURIComponent(defaultProvider)}`)
      .then((next) => { if (active) setEstimate(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [defaultProvider, initialEstimate]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-model-recommendation-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Model recommendation</p>
          <h2 id="vector-model-recommendation-title" className="mt-2 text-2xl font-semibold text-white">Pick the best embedding model</h2>
          <p className="mt-2 text-sm text-slate-400">Uses corpus size, detected providers, and estimated remote cost before indexing.</p>
        </div>
        {loading ? <Spinner label="Loading recommendation" /> : null}
      </div>

      {error ? <div className="mt-4"><ErrorMessage title="Model recommendation unavailable." message={error} /></div> : null}
      {!loading && !estimate ? <p className="mt-4 text-sm text-slate-500">Run provider auto-detect to load a recommendation.</p> : null}
      {estimate ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-50/90">
            <p className="font-semibold text-cyan-100">Recommendation</p>
            <p className="mt-2">{estimate.recommendation}</p>
            <p className="mt-2 text-cyan-100/75">{estimate.formula}</p>
            <p className="mt-2 text-cyan-100/75">{providerSummary(estimate.availableProviders)}</p>
            {estimate.trackingEndpoint ? <p className="mt-2 text-cyan-100/70">Live usage: {estimate.trackingEndpoint}</p> : null}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-sm font-semibold text-white">Cost comparison</p>
            <div className="mt-3 grid gap-2">
              {comparisonRows.map(([provider, item]) => (
                <p key={provider} className="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <span className="font-semibold text-teal-100">{provider}</span> · {item.model ?? 'default model'} · {formatUsd(item.estimatedUsd)}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
