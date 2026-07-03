import { SetupWizardCostEstimate } from "./SetupWizardCostEstimate";
import { StateNotice } from "./StateNotice";
import type { Step, VectorConfig, VectorIndexSource } from "./setupWizardTypes";

export const setupSteps = [
  "Welcome",
  "Local backend",
  "Vault path",
  "Done",
] as const;

export function StepBody({
  step,
  config,
  indexSource = 'auto',
  repoRoot = '',
  onIndexSource,
  onRepoRoot,
}: {
  step: Step;
  config: VectorConfig | null;
  indexSource?: VectorIndexSource;
  repoRoot?: string;
  onIndexSource?: (source: VectorIndexSource) => void;
  onRepoRoot?: (path: string) => void;
}) {
  if (step === 0)
    return (
      <div className="mt-3">
        <StateNotice
          title="Ready to use the local default"
          detail="Arra selects a bundled local vector backend automatically. The provider wizard is optional/advanced."
        />
      </div>
    );
  if (step === 1) return <LocalBackendPlan config={config} />;
  if (step === 2) return <VaultPlan config={config} provider={defaultProvider(config)} source={indexSource} repoRoot={repoRoot} onSource={onIndexSource} onRepoRoot={onRepoRoot} />;
  return (
    <div className="mt-3">
      <StateNotice
        tone="success"
        title="First-run setup complete"
        detail="Continue to the Vector dashboard or watch live progress in Vector Settings."
      />
    </div>
  );
}

function LocalBackendPlan({ config }: { config: VectorConfig | null }) {
  const engine = config?.resolution?.engine ?? "lancedb";
  const collections = Object.entries(config?.config?.collections ?? {});
  return (
    <div className="mt-3 rounded-xl border border-ok-border bg-ok-bg p-3 text-sm text-ok-text">
      <p className="font-semibold">Local vector backend selected: {engine}</p>
      <p className="mt-2">No embedding/provider choice is required for first run. Tune providers later from Vector Settings.</p>
      <p className="mt-2 text-ok-text/80">Configured collections: {collections.length ? collections.map(([key]) => key).join(", ") : "defaults will be used"}</p>
    </div>
  );
}

function defaultProvider(config: VectorConfig | null): string {
  const primary = Object.values(config?.config?.collections ?? {}).find((item) => item.provider);
  return primary?.provider ?? "ollama";
}

function VaultPlan({ config, provider, source, repoRoot, onSource, onRepoRoot }: {
  config: VectorConfig | null;
  provider: string;
  source: VectorIndexSource;
  repoRoot: string;
  onSource?: (source: VectorIndexSource) => void;
  onRepoRoot?: (path: string) => void;
}) {
  const collections = Object.entries(config?.config?.collections ?? {});
  return (
    <div className="mt-2 grid gap-3 text-sm text-text-muted">
      <p>Select the vault path you want to index, then seed the primary vector collection.</p>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        Index source
        <select className="rounded-xl border border-border bg-field px-3 py-2 text-sm normal-case text-text" value={source} onChange={(event) => onSource?.(event.target.value as VectorIndexSource)}>
          <option value="auto">Auto (vault, then SQLite fallback)</option>
          <option value="vault">Vault path</option>
          <option value="sqlite">SQLite documents</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        Vault path
        <input className="rounded-xl border border-border bg-field px-3 py-2 text-sm normal-case text-text" disabled={source === 'sqlite'} placeholder="Optional repo/vault path" value={repoRoot} onChange={(event) => onRepoRoot?.(event.target.value)} />
      </label>
      <p className="text-text-muted">Configured collections: {collections.length ? collections.map(([key]) => key).join(", ") : "none yet"}</p>
      <SetupWizardCostEstimate provider={provider} />
    </div>
  );
}
