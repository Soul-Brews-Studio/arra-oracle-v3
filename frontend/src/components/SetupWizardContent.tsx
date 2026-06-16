import type { Provider, Step, VectorConfig } from "./setupWizardTypes";

export const setupSteps = [
  "Welcome",
  "Provider",
  "Vault path",
  "Index",
] as const;

export function StepBody({
  step,
  providers,
  recommended,
  config,
}: {
  step: Step;
  providers: Provider[];
  recommended?: Provider;
  config: VectorConfig | null;
}) {
  if (step === 0)
    return (
      <p className="mt-2 text-sm text-slate-300">
        Run auto-detect to check Ollama, OpenAI, Gemini, Cloudflare, and
        registered vector services.
      </p>
    );
  if (step === 1)
    return <ProviderList providers={providers} recommended={recommended} />;
  if (step === 2) return <VaultPlan config={config} />;
  return (
    <p className="mt-2 text-sm text-slate-300">
      Done. Continue to the dashboard or watch live progress in Vector Settings.
    </p>
  );
}

function ProviderList({
  providers,
  recommended,
}: {
  providers: Provider[];
  recommended?: Provider;
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
        <article
          key={provider.type}
          className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
        >
          <p className="font-semibold text-purple-100">
            {provider.type}
            {recommended?.type === provider.type ? " · recommended" : ""}
          </p>
          <p className="text-sm text-slate-400">
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
        </article>
      ))}
    </div>
  );
}

function VaultPlan({ config }: { config: VectorConfig | null }) {
  const collections = Object.entries(config?.config?.collections ?? {});
  return (
    <div className="mt-2 text-sm text-slate-300">
      <p>
        Select the vault path you want to index, then seed the primary vector
        collection.
      </p>
      <p className="mt-2 text-slate-400">
        Configured collections:{" "}
        {collections.length
          ? collections.map(([key]) => key).join(", ")
          : "none yet"}
      </p>
    </div>
  );
}
