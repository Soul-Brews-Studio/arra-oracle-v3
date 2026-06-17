import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../pages/vectorSettingsHelpers';

export type VectorCostEstimate = {
  formula: string;
  estimatedUsd: number;
  provider: string;
  recommendation?: string;
  fallbackSummary?: string;
};

type ProviderCost = {
  apiCalls: number;
  estimatedUsd: number;
  inputTokens: number;
  provider?: string;
};

type CostWindow = {
  apiCalls: number;
  estimatedUsd: number;
  inputTokens: number;
  providers?: Record<string, ProviderCost>;
};

export type VectorCostTracking = {
  breakdown?: { daily?: CostWindow };
  usage?: unknown[];
};

interface VectorIndexCostPanelProps {
  indexing?: boolean;
  initialCostEstimate?: VectorCostEstimate | null;
  initialCostTracking?: VectorCostTracking | null;
  loadCostEstimate?: () => Promise<VectorCostEstimate>;
  loadCostTracking?: () => Promise<VectorCostTracking>;
  pollMs?: number;
}

const loadDefaultCostEstimate = () => fetchJson<VectorCostEstimate>('/api/v1/vector/cost-estimate');
const loadDefaultCostTracking = () => fetchJson<VectorCostTracking>('/api/v1/vector/costs');

function formatCost(value: number): string {
  return value === 0 ? 'Free / local' : `$${value.toFixed(4)}`;
}

function providerRows(window?: CostWindow): ProviderCost[] {
  return Object.values(window?.providers ?? {})
    .sort((a, b) => b.inputTokens - a.inputTokens)
    .slice(0, 3);
}

export function VectorIndexCostPanel({
  indexing = false,
  initialCostEstimate,
  initialCostTracking,
  loadCostEstimate = loadDefaultCostEstimate,
  loadCostTracking = loadDefaultCostTracking,
  pollMs = 2000,
}: VectorIndexCostPanelProps) {
  const [costEstimate, setCostEstimate] = useState<VectorCostEstimate | null>(initialCostEstimate ?? null);
  const [costTracking, setCostTracking] = useState<VectorCostTracking | null>(initialCostTracking ?? null);
  const [costError, setCostError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const daily = costTracking?.breakdown?.daily;
  const providers = useMemo(() => providerRows(daily), [daily]);

  useEffect(() => {
    if (initialCostEstimate !== undefined) return;
    let active = true;
    loadCostEstimate()
      .then((next) => { if (active) setCostEstimate(next); })
      .catch((err) => { if (active) setCostError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, [initialCostEstimate, loadCostEstimate]);

  useEffect(() => {
    if (initialCostTracking !== undefined) return;
    let active = true;
    const load = () => loadCostTracking()
      .then((next) => { if (active) setCostTracking(next); })
      .catch((err) => { if (active) setTrackingError(err instanceof Error ? err.message : String(err)); });
    void load();
    if (!indexing || typeof window === 'undefined') return () => { active = false; };
    const timer = window.setInterval(() => { void load(); }, pollMs);
    return () => { active = false; window.clearInterval(timer); };
  }, [indexing, initialCostTracking, loadCostTracking, pollMs]);

  return (
    <>
      {costEstimate ? (
        <div className="mb-4 rounded-2xl border border-accent-border p-4 text-sm text-accent">
          <p className="font-semibold text-accent">Preflight cost before Index Now</p>
          <p className="mt-1">{costEstimate.formula} · {costEstimate.provider}: {formatCost(costEstimate.estimatedUsd)}</p>
          {costEstimate.fallbackSummary ? <p className="mt-1 text-accent opacity-75">{costEstimate.fallbackSummary}</p> : null}
          {costEstimate.recommendation ? <p className="mt-1 text-accent opacity-75">{costEstimate.recommendation}</p> : null}
        </div>
      ) : costError ? <p className="mb-4 text-sm text-warn-text">Cost estimate unavailable: {costError}</p> : null}

      {costTracking ? (
        <div className="mb-4 rounded-2xl border border-cyan-200/20 bg-cyan-200/10 p-4 text-sm text-cyan-50/90">
          <p className="font-semibold text-accent">Live cost tracking</p>
          <p className="mt-1">
            {(daily?.inputTokens ?? 0).toLocaleString()} tokens · {(daily?.apiCalls ?? 0).toLocaleString()} API calls · {formatCost(daily?.estimatedUsd ?? 0)} today
          </p>
          {providers.map((provider, index) => (
            <p key={provider.provider ?? index} className="mt-1 text-accent/75">
              {provider.provider ?? 'provider'}: {provider.inputTokens.toLocaleString()} tokens · {formatCost(provider.estimatedUsd)}
            </p>
          ))}
          {(daily?.inputTokens ?? 0) === 0 ? <p className="mt-1 text-accent/70">No metered indexing usage recorded yet.</p> : null}
        </div>
      ) : trackingError ? <p className="mb-4 text-sm text-warn-text">Live cost tracking unavailable: {trackingError}</p> : null}
    </>
  );
}
