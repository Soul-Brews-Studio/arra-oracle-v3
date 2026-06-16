import { SetupWizardCostEstimate } from "./SetupWizardCostEstimate";
import type { Provider, Step, VectorConfig, VectorIndexSource } from "./setupWizardTypes";

export const setupSteps = [
  "Welcome",
  "Provider",
  "Vault path",
  "Done",
] as const;

export function StepBody({
  step,
  providers,
  recommended,
  selectedProvider = '',
  onProviderSelect,
  config,
  indexSource = 'auto',
  repoRoot = '',
  onIndexSource,
  onRepoRoot,
}: {
  step: Step;
  providers: Provider[];
  recommended?: Provider;
  selectedProvider?: string;
  onProviderSelect?: (provider: string) => void;
  config: VectorConfig | null;
  indexSource?: VectorIndexSource;
  repoRoot?: string;
  onIndexSource?: (source: VectorIndexSource) => void;
  onRepoRoot?: (path: string) => void;
}) {
  if (step === 0)
    return (
      <p className="mt-2 text-sm text-slate-300">
        Run auto-detect to check Ollama, OpenAI, Gemini, Cloudflare, and
        registered vector services.
      </p>
    );
  if (step === 1)
    return <ProviderList providers={providers} recommended={recommended} selectedProvider={selectedProvider} onProviderSelect={onProviderSelect} />;
  if (step === 2) return <VaultPlan config={config} provider={selectedProvider || recommended?.type || "openai"} source={indexSource} repoRoot={repoRoot} onSource={onIndexSource} onRepoRoot={onRepoRoot} />;
  return (
    <p className="mt-2 text-sm text-slate-300">
      Done. Continue to the Vector dashboard or watch live progress in Vector Settings.
    </p>
  );
}

function ProviderList({
  providers,
  recommended,
  selectedProvider,
  onProviderSelect,
}: {
  providers: Provider[];
  recommended?: Provider;
  selectedProvider: string;
  onProviderSelect?: (provider: string) => void;
}) {
  if (!providers.length)
    return (
      <p className="mt-2 text-sm text-slate-300">
        No provider report yet. Configure API keys or start Ollama, then
        auto-detect again.
      </p>
    );
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {providers.map((provider) => (
        <label
          key={provider.type}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
        >
          <span className="flex items-center gap-2 font-semibold text-purple-100">
            <input
              checked={selectedProvider === provider.type}
              name="setup-provider"
              type="radio"
              value={provider.type}
              onChange={() => onProviderSelect?.(provider.type)}
            />
            {provider.type}
            {recommended?.type === provider.type ? " · recommended" : ""}
          </span>
          <p className="mt-2 text-sm text-slate-400">
            {provider.available ? "available" : "unavailable"} ·{" "}
            {(provider.models ?? []).slice(0, 3).join(", ") ||
              provider.status ||
              provider.error ||
              "no models"}
          </p>
          {provider.type.toLowerCase().includes("gemini") ? (
            <p className="mt-2 text-xs font-semibold text-teal-200">
              Free tier available!
            </p>
          ) : null}
        </label>
      ))}
    </div>
  );
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
    <div className="mt-2 grid gap-3 text-sm text-slate-300">
      <p>Select the vault path you want to index, then seed the primary vector collection.</p>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Index source
        <select className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case text-slate-100" value={source} onChange={(event) => onSource?.(event.target.value as VectorIndexSource)}>
          <option value="auto">Auto (vault, then SQLite fallback)</option>
          <option value="vault">Vault path</option>
          <option value="sqlite">SQLite documents</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        Vault path
        <input className="rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm normal-case text-slate-100" disabled={source === 'sqlite'} placeholder="Optional repo/vault path" value={repoRoot} onChange={(event) => onRepoRoot?.(event.target.value)} />
      </label>
      <p className="text-slate-400">Configured collections: {collections.length ? collections.map(([key]) => key).join(", ") : "none yet"}</p>
      <SetupWizardCostEstimate provider={provider} />
    </div>
  );
}
