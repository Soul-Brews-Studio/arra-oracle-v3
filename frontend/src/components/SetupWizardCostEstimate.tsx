import { useEffect, useState } from "react";
import { apiUrl } from "../api";

type CostEstimate = {
  estimatedUsd: number;
  fallbackSummary?: string;
  formula: string;
  provider: string;
  recommendation?: string;
};

type Props = {
  initialEstimate?: CostEstimate | null;
  provider: string;
};

function formatCost(value: number): string {
  return value === 0 ? "Free / local" : `$${value.toFixed(4)}`;
}

async function fetchEstimate(provider: string): Promise<CostEstimate> {
  const qs = new URLSearchParams({ provider });
  const response = await fetch(apiUrl(`/api/v1/vector/cost-estimate?${qs}`), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`/api/v1/vector/cost-estimate returned ${response.status}`);
  return response.json() as Promise<CostEstimate>;
}

export function SetupWizardCostEstimate({ initialEstimate, provider }: Props) {
  const [estimate, setEstimate] = useState<CostEstimate | null>(initialEstimate ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialEstimate !== undefined) return;
    let active = true;
    fetchEstimate(provider || "openai")
      .then((next) => { if (active) setEstimate(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [initialEstimate, provider]);

  if (error) return <p className="text-sm text-[color:var(--color-warn-text,#92400e)]">Preflight cost unavailable: {error}</p>;
  if (!estimate) return <p className="text-sm text-slate-400">Loading preflight cost estimate…</p>;
  return (
    <div className="rounded-2xl border border-[color:var(--color-accent,#0f766e)] p-3 text-sm text-[color:var(--color-accent,#0f766e)]">
      <p className="font-semibold text-[color:var(--color-accent,#0f766e)]">Preflight cost before Start indexing</p>
      <p className="mt-1">{estimate.formula} · {estimate.provider}: {formatCost(estimate.estimatedUsd)}</p>
      {estimate.recommendation ? <p className="mt-1 text-[color:var(--color-accent,#0f766e)] opacity-75">{estimate.recommendation}</p> : null}
      {estimate.fallbackSummary ? <p className="mt-1 text-[color:var(--color-accent,#0f766e)] opacity-75">{estimate.fallbackSummary}</p> : null}
    </div>
  );
}
